# dn-backend — build tracker

Single source of truth for what is built, what is not, and what is blocked.

**Last updated:** 2026-09-22
**Tests:** 112 passing · **Typecheck:** clean
**Spec:** `docs/specs/GRC_SaaS_Automation_Architecture.html`

Legend: ✅ done and tested · 🟡 partial · ⬜ not started · 🚫 blocked

---

## Summary

| Area | Status |
|---|---|
| Form intake (all 4 templates) | ✅ |
| Hidden field capture | ✅ |
| Validation + anti-bot | ✅ |
| Database schema (7 tables) | ✅ |
| Lead scoring | ✅ |
| Sales routing | ✅ |
| Job queue | ✅ |
| Automation Layer 1 | ✅ |
| Consent + unsubscribe | ✅ |
| Automation Layers 2–5 | ⬜ |
| Live integrations (email/Slack/CRM) | 🚫 credentials |
| Production readiness | ⬜ |

**The one sentence that matters:** every form submission is captured, scored, routed
and queued correctly — but with no email or CRM credentials configured, **no human is
notified when a lead arrives.** That is the next thing worth doing.

---

## 1. Form intake — ✅ COMPLETE

### Templates

| Form | `form_id` | Fields | Status |
|---|---|---|---|
| Quick capture | `quick_capture` | 4 (name, email, phone*, company) | ✅ |
| Footer / newsletter | `footer_form` | 1–2 (email, name) | ✅ |
| Book a demo | `demo_form` | 7–8 + framework interest | ✅ |
| Contact us | `contact_form` | 7–8 + inquiry type + message | ✅ |

\* Phone is **optional** on quick capture — deliberate deviation from the spec. GRC
buyers withhold a phone number on a first popup, and the spec already qualifies on the
sales call rather than the form.

Also added beyond the spec: `framework_interest` on the demo form, because Layer 2
nurture branches on framework and the spec's only source for it was AI-parsing the
free-text box.

### Endpoint — ✅

- ✅ `POST /api/forms/:formId/submit`
- ✅ Per-template Zod validation, field-level error responses
- ✅ Unknown fields preserved into `raw_payload` (forensic record)
- ✅ Business-email enforcement — free/disposable providers blocked on lead forms,
  newsletter exempt
- ✅ Idempotency on `submission_uuid` — double-click replays the original response
- ✅ Server-owned fields stripped (`lead_score`, `assigned_to`, `routing_tier`, …)
- ✅ Rate limiting, 5 per IP per hour
- ✅ Opaque response — no score, tier or assignee leaked to the browser

### Hidden fields — ✅ 19 accepted, all stored

| Group | Fields | Status |
|---|---|---|
| UTM | `utm_source` `utm_medium` `utm_campaign` `utm_term` `utm_content` | ✅ |
| Attribution | `first_touch_src` (write-once) `last_touch_src` | ✅ |
| Page context | `page_url` `referrer_url` `landing_page` | ✅ |
| Session | `session_id` `pages_viewed` `visit_count` `time_on_site_sec` `visited_pricing` | ✅ |
| Device | `device_type` | ✅ |
| Anti-bot | `form_render_ms` `website` (honeypot) `recaptcha_token` | ✅ |

Server-derived, never trusted from the client:

| Field | Source | Status |
|---|---|---|
| `ip_address` | `cf-connecting-ip` → `x-forwarded-for[0]` → `x-real-ip` | ✅ |
| `user_agent` | request header | ✅ |
| `geo_country` | `cf-ipcountry` | ✅ |
| device fallback | parsed from user agent when the client sent none | ✅ |
| `consent_ip` | client IP at time of consent | ✅ |
| `geo_region` `geo_city` | ⬜ needs MaxMind | ⬜ |

All hidden fields are optional — a missing UTM parameter must never cost a real lead.
Over-long strings are truncated, not rejected.

### Anti-bot — ✅

- ✅ Honeypot field
- ✅ Submit-speed check (under 3s = bot)
- ✅ reCAPTCHA v3 with score threshold
- ✅ Rate limit
- ✅ **Flag, never drop.** Suspicious submissions are stored and marked; a false
  positive that discards a real enterprise lead costs far more than a spam row
- ✅ Bots receive a normal `200` — telling a bot it was caught only helps it
- ✅ Bots generate zero automation jobs

---

## 2. Data pipeline — ✅ COMPLETE

| Stage | Status | Notes |
|---|---|---|
| 1. Capture | ✅ | Client snippet contract documented in README |
| 2. Validate | ✅ | MX lookup deferred to `enrich` — DNS is too slow for the request path |
| 3. Store | ✅ | One transaction across lead + submission + tracking |
| 4. Score | ✅ | Runs inline; moves to the worker when volume justifies it |
| 5. Route | ✅ | Tiers, SLA deadlines, inquiry-type bypass |

### Schema — ✅ 7 tables

| Table | Purpose | Status |
|---|---|---|
| `leads` | One row per person, dedup on email | ✅ |
| `form_submissions` | One per submit event, many per lead | ✅ |
| `tracking_data` | The hidden fields | ✅ |
| `lead_scores` | Append-only ledger | ✅ |
| `newsletter_subscribers` | Suppression list | ✅ |
| `automation_events` | Audit trail | ✅ |
| `jobs` | Work queue | ✅ |

Deviations from the spec, with reasons, are in `docs/database-design.md`.

### Scoring — ✅

| Dimension | Cap | Status |
|---|---|---|
| `form_intent` | 30 | ✅ |
| `firmographic` | 25 | ✅ |
| `job_title` | 25 | ✅ |
| `behavioral` | 20 | ✅ |

- ✅ Each dimension independently capped; total can never exceed 100
- ✅ Every award written as a ledger row with a readable reason
- ✅ Rollup denormalised onto `leads.lead_score`
- ✅ Title matching is most-senior-first, so "VP of Risk and Compliance" does not
  score as a manager

### Routing — ✅

| Score | Tier | SLA | Slack | Drip | Status |
|---|---|---|---|---|---|
| 80–100 | `enterprise_ae` | 1 h | yes | no | ✅ |
| 50–79 | `sdr` | 4 h | demo only | yes | ✅ |
| 30–49 | `nurture` | — | no | yes | ✅ |
| 0–29 | `marketing_drip` | — | no | no | ✅ |

- ✅ `inquiry_type` bypass for support / partnership / media
- ✅ `request_demo` and `general` correctly treated as real sales leads
- ✅ High scorers excluded from the drip — a rep is calling within the hour
- ✅ Bots never assigned, never alerted on

---

## 3. Job queue — ✅ COMPLETE

Database-backed, not Redis. Jobs are enqueued **inside the write transaction**, so a
process that dies immediately after responding still has the work queued.

- ✅ Enqueue / claim / complete / fail
- ✅ Exponential backoff with jitter, capped at 1 hour
- ✅ Per-type retry budgets (`crm_push` 8 attempts, `ai_extract` 2)
- ✅ Lease expiry — a crashed worker's job is reclaimed, never stranded
- ✅ Dead-lettering; dead rows kept as the error log
- ✅ Pruning of succeeded jobs after 7 days
- ✅ Queue depth on `/health`
- ✅ Idempotent handlers — a retry does not send a second email
- ✅ In-process worker, splittable via `RUN_WORKER=false`

---

## 4. Automation Layer 1 — ✅ built, 🚫 not live

All handlers are written, tested and running. Every one records an `automation_events`
row. But with no credentials configured they run in **simulated mode**: they log what
they would send and record the event as `skipped` rather than `success`.

| Job | Trigger | Built | Live |
|---|---|---|---|
| `enrich` | every submission | ✅ | ✅ |
| `confirmation_email` | every submission | ✅ | 🚫 no provider |
| `fallback_task` | every submission | ✅ | ✅ |
| `crm_push` | every submission | ✅ | 🚫 no CRM |
| `slack_alert` | demo intent only | ✅ | 🚫 no webhook |
| `calendar_send` | demo intent only | ✅ | 🚫 no booking URL |
| `ai_extract` | when message text present | ✅ | ✅ |

Notes:

- `enrich` does phone → E.164 (country-aware), company domain, and country from the
  CDN edge. MaxMind geo is ⬜.
- `ai_extract` is keyword matching, not an LLM. The signals here are keyword-shaped,
  so a deterministic pass is free, instant and testable. Swapping in an LLM later
  costs nothing.
- Layer 1 keys on `form_id` and `inquiry_type` only, never on `lead_score` — these
  must fire even if scoring or routing failed.

---

## 4b. Email sending controls — 🟡 PARTIAL

What protects outbound mail today:

| Control | Status | Note |
|---|---|---|
| Per-submission idempotency | ✅ | A retry never re-sends; a *new* submission always gets its own reply |
| Bounce / complaint suppression | ✅ | Those addresses are never mailed — continuing damages sending reputation for everyone |
| Bot suppression | ✅ | Flagged submissions get no outbound mail, so this cannot become a spam amplifier |
| Retry backoff with jitter | ✅ | An ESP outage does not produce a thundering herd on recovery |
| **Provider send-rate cap** | ⬜ | ESPs throttle; exceeding it gets mail deferred or the account flagged |
| **Per-recipient frequency cap** | ⬜ | Nothing stops one person getting several emails in a day once Layer 5 lands |
| **Global hourly ceiling** | ⬜ | A bug or spam run could fire thousands before anyone notices |
| **Unsubscribe suppression on marketing sends** | ⬜ | Only bounced/complained are blocked today. Transactional confirmations are legitimately exempt, but **Layer 5 cannot ship without this** |
| **Bounce / complaint webhook** | ⬜ | Nothing currently sets those statuses — they can only be set by hand |

The worker's `batchSize: 5` and sequential execution act as an accidental throttle,
but it polls immediately after a full batch, so under a backlog it bursts as fast as
the database allows. That is an artifact, not a designed limit.

**Before any marketing email ships:** unsubscribe suppression, a global ceiling, and
a bounce webhook. All three are independent of the CRM decision.

---

## 5. Consent and compliance — ✅

Not in the original spec. Added because it is not optional.

- ✅ `consent_given`, `consent_ip`, `consent_text_version`, `consent_at`
- ✅ Consent can be granted but never silently revoked by a later form
- ✅ `unsubscribe_token` on every subscriber
- ✅ `GET`/`POST /api/newsletter/unsubscribe`, `POST /api/newsletter/resubscribe`
- ✅ Unsubscribe always reports success, even for an unknown token
- ✅ Suppression survives re-submission — a form submit never resurrects someone who
  opted out
- ✅ Bounced and complained addresses cannot be resubscribed by a link click
- ✅ Logs redact email, phone, IP and raw payload

---

## 6. Automation Layers 2–5 — ⬜ NOT STARTED

### Layer 2 — CRM nurture branching ⬜

| Item | Status | Note |
|---|---|---|
| Content-topic branching | ⬜ | `landing_page` already captured |
| Behavioural branching | ⬜ | `pages_viewed` / `visited_pricing` already captured |
| AI extraction | 🟡 | Keyword version done; CRM property sync ⬜ |
| Progressive profiling | 🟡 | Gap-filling works; the "ask one more field" endpoint ⬜ |

🚫 **Blocked on the CRM decision** — it determines how much is built here versus
configured in the vendor.

### Layer 3 — Content repurposing ⬜

Out of scope for this service. Content ops + CMS + the GEO engine. The only piece
this backend touches is `referrer_url`, already captured.

### Layer 4 — Retention and advocacy ⬜

Needs customer records — onboarding state, NPS, deal stage. There are no customers
here, only leads. A later phase.

### Layer 5 — Email nurture cadence ⬜

| Item | Status |
|---|---|
| 21-day / 8-touch sequence | ⬜ |
| Send-time optimisation | ⬜ |
| Mobile-first templates | ⬜ |
| Drip suppression on human contact | 🟡 `first_contacted_at` column exists, unused |

⚠️ **Open compliance issue:** the cadence sends SMS on days 6 and 18, but no form
captures SMS consent. Either add an explicit opt-in checkbox or drop both touches —
sending without it is TCPA/GDPR exposure.

---

## 7. Production readiness — ⬜

| Item | Status | Note |
|---|---|---|
| MySQL migration | ⬜ | Schema is portable; do it before there is production data |
| Email provider | ⬜ | **Highest value, smallest change** |
| CRM integration | ⬜ | Vendor undecided |
| Slack webhook | ⬜ | Config only |
| Dockerfile | ⬜ | |
| CI | ⬜ | |
| Backups | ⬜ | |
| Shared-store rate limiting | ⬜ | In-memory today, so the limit multiplies per replica |
| Alerting on dead jobs | ⬜ | Failures are recorded but nobody is told |
| Production CORS origins | ⬜ | Still localhost |
| Load testing | ⬜ | |
| Read / admin API | ⬜ | Leads only visible via `db:studio` |

Guarded so it cannot ship broken: `env.ts` refuses to boot in production without
`RECAPTCHA_SECRET_KEY`, or with a wildcard CORS origin.

---

## 8. Open decisions

| Decision | Blocks | Notes |
|---|---|---|
| **CRM vendor** | Layers 2 and 5 | `crm_push` is an interface; intake does not change |
| **Email provider** | Layer 1 going live | SendGrid / Postmark / CRM-native |
| **SMS consent** | Layer 5 | Add a checkbox or drop the two SMS touches |
| **Form placement matrix** | nothing | Affects `form_name` values only, no schema change |
| **Drip vs SLA collision** | Layer 5 | Suppression rule keyed on `first_contacted_at` |

---

## 9. Suggested order

1. **Email provider** — stops leads arriving silently. Highest value, smallest change.
2. **MySQL swap** — cheaper now than after there is production data.
3. **Deployment** — Dockerfile, env config, backups, dead-job alerting.
4. **CRM decision**, then Layer 2.
5. **Layer 5**, once SMS consent is resolved.

---

## Changelog

| Date | Change |
|---|---|
| 2026-09-22 | Form intake, validation, anti-bot, schema, scoring, routing, consent — complete |
| 2026-09-22 | Job queue + Automation Layer 1 — complete |
| 2026-09-22 | Fixed: idempotency guard treated a simulated send as un-done, so retries re-sent |
| 2026-09-22 | Fixed: phone normalisation hardcoded `US`, corrupting international numbers |
| 2026-09-22 | Fixed: `clientCountry` / device fallback were written but never called — geo chain was dead |
| 2026-09-22 | Fixed: confirmation dedup was scoped per *lead*, so a repeat submitter got silence on their second form. Now scoped per submission |
| 2026-09-22 | Added: bounced/complained addresses are suppressed before sending |
| 2026-09-22 | Added: `automation_events.submission_id` — the audit trail now records which submission triggered each automation |
