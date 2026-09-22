# Database design — dn-backend

Reference for the schema in `prisma/schema.prisma`. Seven tables covering form intake,
lead scoring, routing, the marketing-automation audit trail and the job queue.

Source of truth for the design is `GRC_SaaS_Automation_Architecture.html`, plus three
consent/suppression fields carried over from `Website Architecture.drawio`.

---

## Provider status

Running on **SQLite** for development. Moving to **MySQL** later.

The schema is written to make that swap cheap. Nothing SQLite cannot express is used:

| Avoided | Used instead | On the MySQL switch |
|---|---|---|
| `enum` blocks | `String` + Zod enums in `src/schemas/enums.ts` | Convert to native enums; Zod stays as the first line of defence |
| `Json` scalar | `String` holding `JSON.stringify` output | `@db.Json` on `raw_payload` and `payload` |
| `BigInt` / unsigned PKs | `Int @default(autoincrement())` | `BigInt` + `@db.UnsignedBigInt` |
| `@db.*` native types | Prisma defaults | Add `@db.VarChar(n)` / `@db.Text` per column |
| `Decimal` | `Float` for `recaptcha_score` | Stays `Float`; precision is irrelevant here |

Migrations are provider-specific SQL. They get **regenerated**, not converted —
delete `prisma/migrations/`, change `provider`, run `prisma migrate dev` again.
Models, relations and indexes carry over untouched.

**The important consequence of SQLite:** the database does not validate enum values.
A bad `form_id` will be written happily. `src/schemas/enums.ts` is the only enforcement
until MySQL, so every write path must go through Zod.

---

## The seven tables

### 1. `leads` — one row per person

Deduplicated on `email`. This is the central identity record.

Every profile field is nullable, on purpose. The footer form supplies an email and
nothing else; later submissions fill the gaps in. Progressive profiling (Layer 2)
depends on this — a field is asked for only when it is still null.

Holds three groups of derived state that the forms never supply:

- **Enrichment** — `company_domain`, `company_industry`, `country_code`, `region`.
  Written by the `enrich` job from the IP address and email domain.
- **Scoring rollup** — `lead_score` is the denormalised `SUM(points)` from `lead_scores`.
  Kept here so routing and reporting never aggregate at read time.
- **Routing outcome** — `assigned_to`, `routing_tier`, `sla_due_at`, and
  `first_contacted_at`, which is set on the first human touch and is what suppresses
  the automated drip for a lead a rep is already working.

Consent lives here too: `consent_given`, `consent_ip`, `consent_text_version`,
`consent_at`. The HTML spec captures none of this. It is not optional under GDPR,
and `consent_text_version` matters because "they consented" is only defensible if you
can show *what* they consented to.

Attribution: `first_touch_source` is write-once, `last_touch_source` updates on every
submission. Multi-touch attribution needs both.

### 2. `form_submissions` — one row per submit event

Many per lead. This is what makes "subscribed in March, booked a demo in May" a single
person with a visible history rather than two disconnected records.

Two columns that are easy to confuse:

- **`form_id`** — which of the four TEMPLATES was used. A closed set. All automation
  logic and scoring branches on this.
- **`form_name`** — WHERE it was placed (`homepage_popup`, `solutions_banner`).
  Open-ended, so a new placement never needs a migration. Reporting groups on it;
  logic never branches on it.

`submission_uuid` is client-generated and unique. It is the idempotency key: a
double-click or a network retry replays the original response instead of creating a
second lead.

`raw_payload` stores the full POST body as received. It is the forensic record — when
a field gets added to a form before the backend schema catches up, the data is still
captured and recoverable.

Anti-bot verdicts (`recaptcha_score`, `is_suspected_bot`, `bot_reason`) are stored on
the row. Flagged submissions are **kept and marked**, never silently dropped. A false
positive that deletes a real enterprise lead is far more expensive than a spam row.

### 3. `tracking_data` — the ~25 hidden fields

One row per submission, split out so the hot `leads` and `form_submissions` tables stay
narrow and cache-friendly.

Four groups: UTM parameters (all five, plus `first_touch_src` / `last_touch_src` from
the 90-day cookie), page context (`page_url`, `referrer_url`, `landing_page`), session
behaviour (`session_id`, `pages_viewed`, `visit_count`, `time_on_site_sec`,
`visited_pricing`), and device/network (`device_type`, `user_agent`, `ip_address`,
plus geo fields derived later by the `enrich` job).

`landing_page` drives Layer 2's content-topic branching — it is how a lead who arrived
via the SOC 2 checklist gets into the SOC 2 nurture track. `visited_pricing` and
`visit_count` feed the behavioural scoring dimension.

### 4. `lead_scores` — append-only ledger

Never updated, never deleted. One row per awarded point block, each with a
human-readable `reason` like `"Company size: 1000+"`.

`leads.lead_score` is the rollup. Keeping the ledger means any score is fully
explainable — you can always answer "why is this lead an 85" by listing its rows,
and re-scoring is an append, not a destructive overwrite.

Four categories, caps summing to exactly 100:

| Category | Cap | Examples |
|---|---|---|
| `form_intent` | 30 | demo form +30, quick capture +15, footer +5 |
| `firmographic` | 25 | 1000+ employees +25, 51–200 +10 |
| `job_title` | 25 | CISO / VP Risk +25, other +5 |
| `behavioral` | 20 | visited pricing +10, return visitor +7 |

This is the fastest-growing table in the schema. Indexed on `(lead_id, category)`.

### 5. `newsletter_subscribers` — the suppression list

Deliberately separate from `leads`. A footer subscriber is not a sales lead, and
unsubscribing from the newsletter must not touch the lead record — a person can opt out
of marketing email while remaining an active sales opportunity.

`status` (`subscribed` / `unsubscribed` / `bounced` / `complained`) is the suppression
check every send must consult. `unsubscribe_token` is generated at subscribe time and
is legally required in every marketing email. `email_provider_id` holds the ESP's own
id for two-way sync once a provider is chosen.

`lead_id` is nullable and `onDelete: SetNull` — the suppression record must outlive the
lead, or a deleted lead could be silently re-mailed.

### 6. `automation_events` — audit trail

One row per automation that fired for a lead: which one, what happened, how many
attempts, and the error text if it failed.

This is what makes the system debuggable in production. Without it, "why did this
person get two confirmation emails" and "did the CRM push actually succeed" are
unanswerable. With five automation layers firing asynchronously, that is not optional.

### 7. `jobs` — the work queue

A polled table rather than Redis. The reason is atomicity: jobs are enqueued inside
the same transaction that writes the lead, so a process that dies immediately after
responding still has the work queued. A Redis enqueue after the database commit can
be lost in exactly that window.

`status` moves `pending` → `running` → `succeeded`, or to `failed` (retryable, with
`runAt` pushed out by exponential backoff) and finally `dead` once `attempts` reaches
`maxAttempts`. Dead rows are kept — they are the queue's error log.

`lockedAt` / `lockedBy` form a lease. A worker killed mid-job leaves the lock set;
without expiry that job would be stranded forever, so a stale lease is reclaimable
after five minutes.

The claim query filters on `(status, runAt)`, which is exactly the composite index.

---

## Relationships

```
Lead 1──n FormSubmission 1──1 TrackingData
 │
 ├──n LeadScore          (append-only ledger; SUM = Lead.lead_score)
 ├──n AutomationEvent    (audit trail)
 └──0..1 NewsletterSubscriber
```

Cascade behaviour: deleting a lead cascades to its submissions, scores and events.
`NewsletterSubscriber.lead_id` is `SetNull` instead — suppression must survive.

---

## Decisions worth knowing

**Integer primary keys, not UUID.** The HTML spec specifies UUID PKs. In InnoDB a
random UUID primary key fragments the clustered index and inflates every secondary
index, which is a real cost at volume. Each table gets a sequential integer PK, plus a
`public_id` ULID column for anything exposed externally. Nothing leaks a row count.

**Nothing slow in the request path.** The write transaction touches three tables and
returns. Geolocation, company enrichment, email, Slack, CRM push and AI extraction are
all queued jobs. A downstream outage must never fail a form submit.

**Flag, don't drop.** Suspicious submissions are stored with `is_suspected_bot` set.
Filtering happens at read time, where it is reversible.

**Denormalised rollup.** `leads.lead_score` duplicates data that `lead_scores` already
holds. That is intentional — routing and list views read it constantly and must not
aggregate. The `score` job owns both writes and keeps them consistent.

---

## Still open

- **`framework_interest` is a CSV string.** Fine for SQLite. On MySQL it should become
  a proper join table if leads routinely evaluate several frameworks at once, which
  GRC buyers often do.
- **Retention policy.** `raw_payload` and `automation_events` grow without bound and
  have no pruning rule yet.
- **Layer 4 tables do not exist.** Retention and advocacy automation needs customer
  records (onboarding state, NPS, deal stage). There are no customers here, only leads.
  That is a later phase.
