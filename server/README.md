# dn-backend

Backend for the GRC SaaS marketing site. Receives form submissions, scores and routes
them into sales tiers, and keeps an auditable record of every automation that fires.

Built to be dropped into the frontend repo as `server/`.

---

## Quick start

```bash
cd server
npm install
cp .env.example .env
npx prisma migrate dev      # creates prisma/dev.db
npm run db:seed             # 4 sample leads, one per routing tier
npm run dev                 # http://localhost:4000
```

Check it came up:

```bash
curl http://localhost:4000/health
```

### Corporate TLS interception

If `prisma migrate` fails with `unable to get local issuer certificate`, Node is not
trusting the corporate root CA. Prefix commands with the system-CA flag rather than
disabling TLS verification:

```bash
NODE_OPTIONS=--use-system-ca npx prisma migrate dev
```

---

## Deploying this

Step-by-step guides in **[docs/setup/](docs/setup/README.md)** — domain, DNS, email,
database, hosting, and a go-live checklist. Roughly 4 hours and £0–25/month.

---

## Status

Full breakdown in **[docs/TRACKER.md](docs/TRACKER.md)**.

**Built and tested** — 108 tests passing

- `POST /api/forms/:formId/submit` for all four templates
- Zod validation per template, with field-level error responses
- Anti-bot: honeypot, submit-speed, reCAPTCHA v3, rate limiting
- Idempotency on `submission_uuid`
- Lead dedup on email, with progressive gap-filling across submissions
- Scoring (0–100, four capped dimensions) writing an append-only ledger
- Routing into tiers with SLA deadlines, plus inquiry-type bypass
- Newsletter subscribe with suppression-safe upsert, and unsubscribe endpoints
- **Database-backed job queue** with retries, exponential backoff, jitter,
  lease expiry and dead-lettering
- **Automation Layer 1**: confirmation email, Slack alert, calendar link,
  fallback task, CRM push, enrichment, message parsing
- Every automation writes an `automation_events` row, so what fired for whom is
  answerable

**Not built yet**

- Layers 2–5 (nurture branching, content repurposing, retention, email cadence)
- Real email provider, Slack webhook and CRM credentials — every integration runs
  in simulated mode until configured, logging what it *would* send and recording
  the event as `skipped`
- MaxMind geolocation

---

## API

Every request is available as copy-paste curl in
**[docs/api-examples.md](docs/api-examples.md)**, or as an importable Postman
collection: **[docs/postman_collection.json](docs/postman_collection.json)**.

### `POST /api/forms/:formId/submit`

`:formId` is one of `quick_capture`, `footer_form`, `demo_form`, `contact_form`.

Every payload needs `submission_uuid` (a client-generated v4 UUID — the idempotency
key) and `form_name` (the placement, e.g. `homepage_popup`).

```bash
curl -X POST http://localhost:4000/api/forms/demo_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "d84e628a-0bd5-4a97-9c02-f2e71d4a42a9",
    "form_name": "book_a_demo",
    "first_name": "Elena",
    "last_name": "Fischer",
    "email": "elena.fischer@meridian-bank.com",
    "phone": "+49 30 12345678",
    "company_name": "Meridian Bank",
    "job_title": "Chief Information Security Officer",
    "company_size": "1000+",
    "framework_interest": ["soc2", "iso27001"],
    "message": "Audit deadline in 6 weeks",
    "consent_given": true,
    "utm_source": "google",
    "visited_pricing": true,
    "visit_count": 3,
    "pages_viewed": 8,
    "form_render_ms": 45000
  }'
```

```json
{ "ok": true, "submission_id": "01M34B408AK5EJSAZ7BMGMM10B" }
```

The response deliberately carries no score, tier or assignee — that is internal sales
intelligence and the browser has no use for it.

| Status | `error` | Meaning |
|---|---|---|
| 200 | — | Stored. Also returned for flagged submissions — telling a bot it was caught only helps it |
| 400 | `validation_failed` | Field errors in `fields` |
| 400 | `personal_email` | Free provider on a lead form. `footer_form` is exempt |
| 404 | `unknown_form` | Unknown `:formId` |
| 429 | `rate_limited` | Over the per-IP limit |
| 500 | `storage_failed` | Write failed |

### What the frontend must send

Beyond the visible fields, the tracking snippet should attach:

- **UTM** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`,
  persisted in a 90-day first-party cookie, plus write-once `first_touch_src`
- **Page context** — `page_url`, `referrer_url`, `landing_page`
- **Session** — `session_id`, `pages_viewed`, `visit_count`, `time_on_site_sec`,
  `visited_pricing`, `device_type`
- **Anti-bot** — `form_render_ms` (ms between render and submit), `website` (the
  honeypot input, hidden via CSS and left empty), `recaptcha_token`

All of it is optional. A missing UTM parameter must never cost a real lead, so absence
is never treated as a failure.

### Other endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Pings the database. 503 when unreachable |
| `GET` | `/health/live` | Liveness only, for restart policies |
| `GET` | `/api/newsletter/unsubscribe?token=` | One-click unsubscribe, redirects |
| `POST` | `/api/newsletter/unsubscribe` | JSON variant for a preference centre |
| `POST` | `/api/newsletter/resubscribe` | Requires the same token |

An unsubscribe always reports success, even for an unknown token. Telling someone
"that link is invalid" when they are trying to leave is hostile and a compliance risk.

---

## Scoring and routing

Composite 0–100 across four independently capped dimensions.

| Dimension | Cap | Signals |
|---|---|---|
| `form_intent` | 30 | demo 30, contact 20, quick capture 15, footer 5 |
| `firmographic` | 25 | 1000+ → 25, 201–1000 → 18, 51–200 → 10, 1–50 → 3 |
| `job_title` | 25 | CISO/CRO/CCO/VP Risk 25 … non-buyer roles 0 |
| `behavioral` | 20 | pricing page 10, return visitor 7, deep session 5 |

Every award is a row in `lead_scores` with a readable reason, so any score is
explainable. `leads.lead_score` is the denormalised rollup.

| Score | Tier | SLA | Slack | Drip |
|---|---|---|---|---|
| 80–100 | `enterprise_ae` | 1 hour | yes | no |
| 50–79 | `sdr` | 4 hours | demo only | yes |
| 30–49 | `nurture` | — | no | yes |
| 0–29 | `marketing_drip` | — | no | no |

High scorers are **not** enrolled in the drip: a rep is calling within the hour, and an
automated email arriving the same morning reads as disorganised.

A `contact_form` with `inquiry_type` of `support`, `partnership` or `media` bypasses
scoring entirely. `request_demo` and `general` do not — those are real sales leads.

---

## Layout

```
server/
  prisma/
    schema.prisma          7 models
    migrations/
    seed.ts
  src/
    index.ts               bootstrap, graceful shutdown
    app.ts                 Fastify factory (test-injectable)
    env.ts                 Zod-validated config, exits at boot on failure
    db.ts                  Prisma singleton + SQLite pragmas
    routes/                health, submit, newsletter
    schemas/               enums (source of truth), forms, hidden fields
    services/              antibot, scoring, routing, persist, providers
    queue/
      types.ts             job types + retry policy
      driver.ts            enqueue / claim / complete / fail
      dispatch.ts          which jobs a submission triggers
      handlers.ts          Layer 1 automations
      worker.ts            poll loop
    lib/                   clientIp, logger
  tests/
    unit/                  scoring, routing, validation, dispatch
    integration/           submit endpoint + queue, against the real DB
  docs/
    setup/                     step-by-step guides: domain -> DNS -> hosting -> live
    TRACKER.md                 what is done, what is not, what is blocked
    api-examples.md            every request as curl
    postman_collection.json    importable, 19 requests with assertions
    database-design.md
    specs/                 the two original design documents
```

---

## Database

SQLite now, MySQL later. `docs/database-design.md` covers the schema and the swap path.

**The one thing to remember:** SQLite has no native enums, so the schema stores them as
`String`. The database will not reject a bad value — `src/schemas/enums.ts` is the only
enforcement. Every write path must go through Zod.

```bash
npm run db:studio      # browse data
npm run db:migrate     # create + apply a migration
npm run db:seed        # re-seed (safe to re-run)
```

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Watch mode on :4000 |
| `npm test` | Full suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile to `dist/` |

---

## The job queue

Slow work — email, Slack, CRM push, enrichment, message parsing — runs as jobs, not
inside the request. A downstream outage must never fail a form submit.

**It is a database table, not Redis.** Two reasons:

1. **Atomicity.** Jobs are enqueued inside the same transaction that writes the lead.
   If the process dies immediately after responding, the work is still queued. A
   Redis enqueue that happens after the database commit can be lost in exactly that
   window.
2. **No extra infrastructure** to run, deploy or monitor.

The cost is latency (up to one poll interval, default 2s) and no cross-process
fan-out. At marketing-form volume, neither binds. Swapping to BullMQ later means
reimplementing `src/queue/driver.ts` — nothing that calls `enqueue()` changes.

### Jobs

| Type | When | Retries |
|---|---|---|
| `enrich` | every submission | 3 |
| `confirmation_email` | every submission | 5 |
| `fallback_task` | every submission | 3 |
| `crm_push` | every submission | 8 |
| `slack_alert` | demo intent only | 3 |
| `calendar_send` | demo intent only | 5 |
| `ai_extract` | when a message field is filled | 2 |

Retry budgets encode how much a failure matters. `crm_push` retries hardest — a lead
that never reaches the CRM is invisible to sales. `slack_alert` gives up quickly — a
late alert is noise. Backoff is exponential with jitter, capped at one hour; the
jitter stops fifty jobs failed by one outage from retrying in lockstep and knocking
the recovering service over again.

A suspected bot generates **no jobs at all**. The submission is stored and visible,
but there is no outbound contact, no CRM pollution and no API spend.

Layer 1 jobs key on `form_id` and `inquiry_type` only, never on `lead_score`. They
must fire even if scoring or routing failed entirely.

### Failure handling

- A failed job is rescheduled with backoff; the row is never lost
- Exhausted retries move a job to `dead`, which stays in the table — dead jobs are
  the queue's error log, and deleting them hides the failures someone needs to see
- Only `succeeded` jobs are pruned, after 7 days
- A worker killed mid-job leaves an expired lease, which another worker reclaims
- Handlers are idempotent: each checks `automation_events` before repeating a side
  effect, so a retry after a lost acknowledgement does not send a second email

### Running it

The worker runs in-process by default. To split it out, set `RUN_WORKER=false` on the
API and run a dedicated worker process — otherwise both claim the same jobs.

Queue depth is on `/health`:

```json
{ "checks": { "database": "ok",
              "queue": { "pending": 0, "running": 0, "succeeded": 11, "failed": 0, "dead": 0 } } }
```

A rising `pending` count means the worker is behind. Any `dead` count needs a human.

### Simulated integrations

No email, Slack or CRM credentials are configured yet, so those providers log what
they would send and return `simulated: true`. The job still succeeds and the audit
trail records the event as `skipped` rather than `success` — the distinction matters,
because `success` would claim an email was sent when it was not.

Wiring a real vendor means writing one function in `src/services/providers.ts`. No
caller changes.

---

## Security notes

- **Server-owned fields are stripped from every payload** before validation —
  `lead_score`, `assigned_to`, `routing_tier`, `ip_address` and friends. A client that
  posts `"lead_score": 100` is silently ignored. Covered by tests.
- **IP comes from the proxy chain**, never the body. `trustProxy` is on, so run this
  behind Cloudflare or nginx — exposed directly, the client controls `x-forwarded-for`
  and the rate limiter becomes bypassable.
- **Suspicious submissions are flagged, never dropped.** A false positive that discards
  a real enterprise lead costs far more than a spam row costs to filter.
- **Logs are redacted** for email, phone, IP and raw payload. Without that the log store
  becomes a second copy of the lead database with none of its access controls.
- **Rate limiting is in-memory.** Fine for one instance; it must move to a shared store
  before running replicas, or the effective limit multiplies by the replica count.

---

## Open decisions

- **CRM vendor** — decides how much of Layers 2 and 5 is built here versus configured
  there. `crm-push` stays an interface until then.
- **Email provider** — SendGrid, Postmark, or CRM-native.
- **SMS consent.** Layer 5 sends SMS on days 6 and 18, but no form captures SMS opt-in.
  Add an explicit checkbox or drop both touches — otherwise it is TCPA/GDPR exposure.
- **Form placement matrix** — which template goes on which page. Affects `form_name`
  values only, no schema change.
