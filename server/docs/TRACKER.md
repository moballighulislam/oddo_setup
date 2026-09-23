# dn-backend — build tracker

**Handoff document.** If you are picking this repo up cold, read this first. It records
what is finished, what is half-finished and exactly what is missing, which decisions
are already settled and why, and the traps that will otherwise cost you an hour.

**Last updated:** 2026-09-23
**Tests:** 144 passing · **Typecheck:** clean
**Spec:** `docs/specs/GRC_SaaS_Automation_Architecture.html`
**Repo:** https://github.com/moballighulislam/oddo_setup — **public, never commit secrets**

Legend: ✅ done · 🟡 partial, details given · ⬜ not started · 🚫 blocked

---

## 30-second summary

Backend for a GRC SaaS marketing site. Captures form submissions, scores and routes
them into sales tiers, quarantines spam, and runs marketing automation asynchronously.

**Working end to end:** form intake → validation → anti-bot → scoring → routing → job
queue → Odoo CRM. Verified against a live Odoo instance.

**The one thing still missing that matters:** no email provider. A lead arrives, saves
to the database, reaches Odoo — and **nobody is emailed**. The submitter gets no
confirmation, the team gets no Slack alert. All of it is built; it needs an API key.

---

## Status at a glance

| Area | Status |
|---|---|
| Form intake, 4 templates | ✅ |
| Hidden field capture (30 fields) | ✅ |
| Anti-bot + junk quarantine | ✅ |
| Database schema (9 tables) | ✅ SQLite |
| Lead scoring + sales routing | ✅ |
| Job queue | ✅ |
| Odoo CRM integration | ✅ live |
| IP geolocation | ✅ |
| Automation Layer 1 | 🟡 built, email/Slack not live |
| Email sending | 🚫 no provider |
| Automation Layers 2–5 | ⬜ |
| MySQL migration | ⬜ |
| Deployment | ⬜ |
| Admin / read API | ⬜ |

---

## Settled decisions — do not re-litigate

These were argued through and decided. Changing one needs a reason, not a preference.

| Decision | Why |
|---|---|
| **Integer PKs, not UUID** | The spec says UUID. Random UUID PKs fragment the InnoDB clustered index and bloat every secondary index. Each table has a sequential PK plus a `public_id` ULID for external exposure |
| **Database-backed job queue, not Redis** | Jobs are enqueued *inside* the write transaction, so work cannot be lost if the process dies after responding. A Redis enqueue after commit can be. Also removes a whole piece of infrastructure |
| **Junk goes to its own table** | `junk_submissions`, never `leads`. Keeps counts, exports and CRM pushes clean |
| **Quarantine, never drop** | The full payload is stored and `promoteJunkSubmission()` replays it through the normal submit path. reCAPTCHA scores corporate VPNs low; without a way back, the table silently eats real leads |
| **Sales tiers → Odoo Opportunity, nurture tiers → Odoo Lead** | Otherwise the pipeline fills with newsletter subscribers and stops being a forecast |
| **Non-sales inquiries never reach the CRM** | support / partnership / media are not deals |
| **Layer 1 keys on `form_id` only, never on score** | Those automations must still fire if scoring or routing failed |
| **Flagged submissions get HTTP 200** | Telling a bot it was detected only helps it tune around the checks |
| **Consent fields + unsubscribe added beyond the spec** | GDPR. The spec captures neither |
| **Odoo, One App Free** | CRM only. Installing a second app ends the free tier |
| **4 pipeline stages, 4 lost reasons** | Sized for a pre-launch startup. An earlier 6-stage design was cut — a pipeline nobody maintains is worse than none |

---

## 1. Form intake — ✅ COMPLETE

Four templates: `quick_capture`, `footer_form`, `demo_form`, `contact_form`.

- ✅ `POST /api/forms/:formId/submit`, per-template Zod validation, field-level errors
- ✅ Unknown fields preserved into `raw_payload`
- ✅ Business-email enforcement (newsletter exempt)
- ✅ Idempotency on `submission_uuid`
- ✅ Server-owned fields stripped before validation
- ✅ Rate limiting, 5/IP/hour
- ✅ Response leaks no score, tier or assignee

Deliberate deviations from the spec: phone optional on `quick_capture`;
`framework_interest` added to `demo_form`; MX lookup moved off the request path.

### Hidden fields — 30 accepted

UTM ×5 · `first_touch_src` / `last_touch_src` · `page_url` (with query string) ·
`referrer_url` · `landing_page` · `gclid` / `fbclid` / `msclkid` / `li_fat_id` ·
`session_id` · `pages_viewed` · `page_journey` · `visit_count` · `time_on_site_sec` ·
`days_since_first_visit` · `visited_pricing` · `scroll_depth` · `device_type` ·
`browser_language` · `browser_timezone` · `form_render_ms` · `website` (honeypot) ·
`recaptcha_token`

Server-derived, never trusted from the client: `ip_address`, `user_agent`,
`geo_country` (CDN header), device fallback, `consent_ip`.

⚠️ The frontend snippet that produces these lives in
`docs/setup/07-connect-frontend-backend.md` and **is not deployed anywhere yet**.

---

## 2. Anti-bot and junk — ✅ COMPLETE

Honeypot · submit-speed · reCAPTCHA v3 · rate limit.

Failing submissions go to `junk_submissions` with their **full payload**, generate no
jobs, and never create a Lead. 90-day retention; promoted rows never pruned.

- ✅ `promoteJunkSubmission()` — replays through the normal submit path, so a promoted
  lead is scored and routed identically
- ✅ `listJunkForReview()` — orders `low_score` first, since that is reCAPTCHA's
  judgement rather than a hard signal
- ✅ Counts by reason on `/health`
- ⬜ **No review UI or endpoint.** The functions exist, nothing exposes them. Use
  Prisma Studio until the admin API lands

---

## 3. Scoring and routing — ✅ COMPLETE

Four capped dimensions summing to 100: `form_intent` 30, `firmographic` 25,
`job_title` 25, `behavioral` 20. Every award is a ledger row with a readable reason;
`leads.lead_score` is the rollup.

Tiers: 80–100 `enterprise_ae` (1h SLA) · 50–79 `sdr` (4h) · 30–49 `nurture` · 0–29
`marketing_drip`. `inquiry_type` bypass for support / partnership / media.

⚠️ **The weights are an informed guess and have never been checked against real
outcomes.** Once 20–30 leads have known results, compare: are ⭐⭐⭐ leads actually the
ones converting? Retune if not. This is the feedback loop that makes scoring worth
having.

---

## 4. Job queue — ✅ COMPLETE

Database table, polled, enqueued inside the write transaction.

Retries with exponential backoff + jitter · per-type budgets (`crm_push` 8,
`ai_extract` 2) · lease expiry for crashed workers · dead-lettering · 7-day pruning of
succeeded rows · depth on `/health` · idempotent handlers.

Worker runs in-process. `RUN_WORKER=false` splits it out.

---

## 5. Automation Layer 1 — 🟡 BUILT, PARTLY LIVE

| Job | Built | Live | Blocker |
|---|---|---|---|
| `enrich` | ✅ | ✅ | — |
| `fallback_task` | ✅ | ✅ | — |
| `ai_extract` | ✅ | ✅ | — |
| `crm_push` | ✅ | ✅ | — |
| `confirmation_email` | ✅ | 🚫 | no email provider |
| `slack_alert` | ✅ | 🚫 | no webhook URL |
| `calendar_send` | ✅ | 🚫 | no booking URL |

Unconfigured providers log their intent and record the event as `skipped`, never
`success` — the audit trail must not claim an email was sent when it was not.

🟡 **`ai_extract` is keyword matching, not an LLM.** Deliberate: the signals here
(framework names, urgency words) are keyword-shaped, so a deterministic pass is free,
instant and testable. Swap in an LLM when there is something genuinely semantic to
extract — one function in `src/queue/handlers.ts`.

---

## 6. Odoo CRM — ✅ LIVE

Instance `https://deepnotch.odoo.com`, database `deepnotch`, Odoo 19.4 Enterprise.
Configured: team `Inbound`; stages New → Contacted → Meeting → Proposal → Won; lost
reasons Dead, Junk, Out of Scope, Bad Timing, Competitor.

Verified live: a demo submission became a 94-point Opportunity with ★★★, country from
the CDN header, a German phone normalised to E.164, native UTM mapping, tier and
framework tags, and a description covering attribution, behaviour, page journey and
context.

⚠️ **The API key expires 3 months from 2026-09-23.** Odoo 19 requires an expiry and
offers no "never". `/health` reports `crm: ok`, so expiry is visible rather than
silent. Rotate: new key → update `ODOO_API_KEY` → redeploy.

⬜ Not built: SLA → Odoo Activity. Deferred deliberately; with a handful of leads a
month you will not miss one. A few lines when volume justifies it.

---

## 7. Email — 🚫 BLOCKED, HIGHEST VALUE

**This is the next thing to do.** Follow `docs/setup/02-email-provider.md`. Resend,
free tier, ~30 minutes of account setup.

What exists:

- ✅ Per-submission idempotency (scoped to submission, not lead — a repeat submitter
  gets a reply for each form)
- ✅ Bounce/complaint suppression before sending
- ✅ Bots never emailed
- ✅ Retry backoff with jitter

What is missing:

- 🚫 `sendEmail()` throws if a key is set — no provider implementation exists yet
  (`src/services/providers.ts`)
- ⬜ Provider send-rate cap
- ⬜ Per-recipient frequency cap
- ⬜ Global hourly ceiling
- ⬜ **Unsubscribe suppression on marketing sends.** Only bounced/complained are
  blocked today. Transactional confirmations are legitimately exempt, but **Layer 5
  cannot ship without this**
- ⬜ Bounce/complaint webhook. Nothing currently sets those statuses — they can only
  be set by hand

---

## 8. Layers 2–5 — ⬜ NOT STARTED

### Layer 2 — CRM nurture branching

| Item | Status |
|---|---|
| Content-topic branching | ⬜ `landing_page` already captured |
| Behavioural branching | ⬜ `pages_viewed`, `visited_pricing`, `page_journey` captured |
| AI extraction → CRM properties | 🟡 extraction done, CRM sync not |
| Progressive profiling | 🟡 gap-filling works; the "ask one more field" endpoint ⬜ |

No longer blocked — the CRM decision is made.

### Layer 3 — Content repurposing ⬜

Out of scope for this service. Content ops + CMS. The only backend surface is
`referrer_url`, already captured.

### Layer 4 — Retention and advocacy ⬜

Needs customer records — onboarding state, NPS, deal stage. There are no customers,
only leads. A later phase.

### Layer 5 — Email nurture cadence ⬜

21-day / 8-touch sequence, send-time optimisation, mobile-first templates.

🟡 `first_contacted_at` exists as a column but is **unused** — it is what should
suppress the drip once a rep makes contact. Unresolved collision: score 80–100 gets a
1-hour SLA while the cadence also starts at day 0.

⚠️ **Compliance blocker:** the cadence sends SMS on days 6 and 18, but no form captures
SMS consent. Add an explicit opt-in checkbox or drop both touches.

---

## 9. Production readiness — ⬜

| Item | Status | Note |
|---|---|---|
| MySQL migration | ⬜ | Schema is portable. **Do it before there is production data** |
| Email provider | 🚫 | Highest value |
| Slack webhook / calendar URL | ⬜ | Config only, both already coded |
| Dockerfile | ⬜ | |
| CI | ⬜ | |
| Backups | ⬜ | |
| Shared-store rate limiting | ⬜ | In-memory today, so the limit multiplies per replica |
| **Alerting on dead jobs** | ⬜ | Failures are recorded but nobody is told. Biggest blind spot |
| Production CORS origins | ⬜ | Still localhost |
| Admin / read API | ⬜ | Leads only visible via Prisma Studio |
| Load testing | ⬜ | |

Guards that already prevent a bad deploy: production refuses to boot without
`RECAPTCHA_SECRET_KEY`, or with `*` in `CORS_ORIGINS`.

### MySQL migration — what it involves

`docs/database-design.md` has the detail. Mechanically:

1. Change `provider` in `schema.prisma`
2. Convert String enum columns to native enums — **the database then starts rejecting
   bad values. Today `src/schemas/enums.ts` is the only enforcement**
3. `raw_payload`, `payload`, `page_journey` → `@db.Json`
4. `Int` PKs → `BigInt @db.UnsignedBigInt`
5. Add `@db.VarChar(n)` / `@db.Text`
6. Delete `prisma/migrations/`, regenerate, re-run the suite
7. Remove the SQLite PRAGMA block in `src/db.ts`

Half a day.

---

## 10. Traps that will cost you an hour

**Corporate TLS interception.** On the original developer machine Node does not trust
the proxy CA. Prisma engine downloads and every Odoo call fail with `fetch failed` or
`unable to get local issuer certificate`:

```bash
NODE_OPTIONS=--use-system-ca npx prisma migrate dev
NODE_OPTIONS=--use-system-ca npm run dev
```

Not needed in production.

**`.env` is not auto-loaded.** Node needs `--env-file`. The npm scripts pass it; a bare
`tsx src/index.ts` exits complaining `DATABASE_URL: Required`.

**Tests must never touch live services.** `tests/setup.ts` loads `.env` and then
*clears* `ODOO_*`, `EMAIL_PROVIDER_API_KEY`, `SLACK_WEBHOOK_URL` and
`RECAPTCHA_SECRET_KEY`. Without that, adding real credentials points the suite at the
production Odoo instance and creates junk records there.
`tests/integration/odoo.test.ts` starts its own stub server.

**Server startup takes ~12s** with tsx + Prisma. A scripted `curl` immediately after
launch gets an empty response. Not a bug.

**`env` is frozen at import.** Mutating `process.env` afterwards has no effect — tests
needing different config must set it before importing, or use a stub.

**PRAGMA statements need `$queryRawUnsafe`.** Several return a row, and
`$executeRawUnsafe` rejects any statement that returns results.

**IP geolocation sends the visitor IP to a third party** (`ip-api.com`), which makes it
a data processor under GDPR — it belongs in the privacy policy. `GEO_PROVIDER=none`
disables it. Swapping to a local MaxMind database means replacing one function in
`src/services/geo.ts`.

---

## 11. Suggested order

1. **Email provider** — stops leads arriving unnoticed. Highest value
2. **MySQL migration** — cheaper now than after production data exists
3. **Deployment** — Dockerfile, env config, backups, dead-job alerting
4. **Admin API** — so the team can see leads and review junk without database access
5. **Layer 2** — no longer blocked
6. **Layer 5** — once SMS consent and the drip/SLA collision are resolved

---

## 12. Where things live

```
server/
  prisma/schema.prisma          9 models
  src/
    routes/submit.ts            the only public write endpoint
    services/
      scoring.ts  routing.ts    pure functions, unit-tested
      antibot.ts  junk.ts       quarantine + promotion
      persist.ts                the write transaction
      odoo.ts                   CRM client (JSON-RPC)
      providers.ts              email / Slack / CRM seam
      geo.ts                    IP lookup
    queue/
      driver.ts                 enqueue / claim / complete / fail
      dispatch.ts               which jobs a submission triggers
      handlers.ts               Layer 1
  docs/
    setup/                      11 step-by-step guides, 01 → 11
    database-design.md          schema reference + MySQL swap path
    api-examples.md             every request as curl
    postman_collection.json     19 requests, importable
    specs/                      the two original design documents
```

---

## Changelog

| Date | Change |
|---|---|
| 2026-09-22 | Form intake, validation, anti-bot, schema, scoring, routing, consent |
| 2026-09-22 | Job queue + Automation Layer 1 |
| 2026-09-22 | Fixed: idempotency guard treated a simulated send as un-done, so retries re-sent |
| 2026-09-22 | Fixed: phone normalisation hardcoded `US`, corrupting international numbers |
| 2026-09-22 | Fixed: `clientCountry` / device fallback written but never called — geo chain was dead |
| 2026-09-22 | Fixed: confirmation dedup scoped per *lead*, so a repeat submitter got silence |
| 2026-09-22 | Odoo CRM integration; `automation_events.submission_id` added |
| 2026-09-23 | Junk quarantine table + promotion path |
| 2026-09-23 | Odoo connectivity on `/health` so key expiry is visible |
| 2026-09-23 | Fixed: test suite was reaching the live Odoo instance |
| 2026-09-23 | Tracking expanded 19 → 30 fields; full detail surfaced in Odoo; IP geolocation |
| 2026-09-23 | Fixed: `getCookie` regex in the documented snippet read only the first cookie |
