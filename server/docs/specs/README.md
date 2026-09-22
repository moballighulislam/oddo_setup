# Source specifications

The two original design documents this backend is built from. Kept verbatim as the
historical record — **do not treat either as current**. Where they disagree with
`../database-design.md`, the database-design doc wins.

---

## `GRC_SaaS_Automation_Architecture.html` — authoritative

Open in a browser. Six tabs.

Covers the four form templates with full field lists, the ~25 auto-captured hidden
fields, the five-stage pipeline (capture → validate → store → score → route), the
scoring model, sales routing tiers, and marketing automation Layers 1–5.

**This is the spec the backend implements.**

Deviations already made, and why:

| Spec says | Built as | Reason |
|---|---|---|
| UUID primary keys | Integer PK + `public_id` ULID | Random UUID PKs fragment the InnoDB clustered index |
| No consent fields | `consent_given`, `consent_ip`, `consent_text_version`, `consent_at` | GDPR |
| No unsubscribe path | `newsletter_subscribers` + `unsubscribe_token` | Legally required on marketing email |
| MX lookup during validation | Moved to the async `enrich` job | DNS is too slow for the request path |
| Layers 3 and 4 | Not built | Content-ops and post-sale; no backend surface yet |

## `Website_Architecture.drawio` — superseded

Open at [app.diagrams.net](https://app.diagrams.net). Uncompressed mxGraph XML, ~296 labels.

Site structure, page inventory, per-page form placement matrix, and an early backend
sketch (Bun, agents, ML analytics).

**Superseded for process and stack.** Three things were kept from it because the HTML
spec omitted them: `consent_given` / `consent_ip`, `unsubscribe_token`, and the
subscriber status enum.

Known problems in this file, for anyone reading it cold:

- The `lead_DB` and `newsletter_DB` blocks contain **identical columns** — both hold the
  newsletter schema. `lead_DB` is a copy-paste artefact, not a real lead design.
- Anti-bot contradicts itself: a `turnstile_verified` column alongside a
  "Recaptcha check before every submission" note. Resolved as reCAPTCHA v3.
- Its CTA popup has 7 fields; the HTML spec's quick capture has 4. The HTML version won —
  7 fields in an interrupting popup will not convert.
- The demo form — the highest-value form — appears nowhere in the placement matrix.

Still useful for one thing: the **page-to-form placement matrix**, which the HTML spec
does not have. That maps to `form_name` values only and needs no schema change.

---

## Open questions neither document answers

- CRM vendor (HubSpot / ActiveCampaign / other) — `crm-push` is an interface until decided
- Email provider — SendGrid / Postmark / CRM-native
- SMS consent. Layer 5 sends SMS on days 6 and 18, but no form captures SMS opt-in.
  Either add a checkbox or drop both touches — TCPA/GDPR exposure otherwise.
- Drip vs SLA collision. Score 80–100 gets a rep call within 1 hour while the 21-day
  cadence also starts at day 0. Needs a suppression rule keyed on `first_contacted_at`.
