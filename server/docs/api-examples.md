# API examples — curl / Postman

Every request against the form intake API, ready to paste.

- **Base URL:** `http://localhost:4000`
- **Importable Postman collection:** [`postman_collection.json`](./postman_collection.json)

---

## Before you start

### Windows

In PowerShell, `curl` is an alias for `Invoke-WebRequest` and will **not** accept these
flags. Use `curl.exe` explicitly, or run them in Git Bash:

```powershell
curl.exe -X POST http://localhost:4000/health
```

The examples below are written for **Git Bash / macOS / Linux**.

### `submission_uuid` must be unique per submission

It is the idempotency key. Reusing one replays the original response instead of
creating a new lead — that is the point, but it means a copy-pasted UUID will look
like "nothing happened" on the second run.

- **Git Bash:** `$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')`
- **macOS / Linux:** `$(uuidgen)`
- **Postman:** `{{$guid}}` — Postman generates a fresh one per request automatically

### Rate limit

5 submissions per IP per hour by default. Testing more than that returns `429`. Raise
it for a session:

```bash
RATE_LIMIT_MAX=500 npm run dev
```

---

## 1. Health

```bash
curl -s http://localhost:4000/health
```

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "queue": { "pending": 0, "running": 0, "succeeded": 11, "failed": 0, "dead": 0 }
  },
  "env": "development",
  "uptime": 17,
  "timestamp": "2026-09-22T11:16:17.812Z"
}
```

Liveness only, no dependency checks:

```bash
curl -s http://localhost:4000/health/live
```

---

## 2. Quick capture — homepage popup

The 4-field template. Phone is optional.

```bash
UUID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')

curl -s -X POST http://localhost:4000/api/forms/quick_capture/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$UUID"'",
    "form_name": "homepage_popup",

    "full_name": "Jane Okonkwo",
    "email": "jane.okonkwo@stellar-payments.com",
    "phone": "+1 212 456 7890",
    "company_name": "Stellar Payments",

    "consent_given": true,
    "consent_text_version": "v1",

    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "grc_q4",
    "page_url": "/platform",
    "referrer_url": "https://www.google.com/",
    "landing_page": "/platform",
    "session_id": "sess_a8f3c9d2",
    "pages_viewed": 4,
    "visit_count": 2,
    "visited_pricing": true,
    "device_type": "desktop",

    "form_render_ms": 32000,
    "website": ""
  }'
```

```json
{ "ok": true, "submission_id": "01M34B408AK5EJSAZ7BMGMM10B" }
```

Expected: score ~45–55, tier `sdr` or `nurture`.

---

## 3. Footer form — newsletter

Lowest-commitment template. Personal email addresses are **allowed** here.

```bash
UUID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')

curl -s -X POST http://localhost:4000/api/forms/footer_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$UUID"'",
    "form_name": "site_footer",

    "email": "practitioner@gmail.com",
    "full_name": "Sam Rivera",

    "consent_given": true,
    "consent_text_version": "v1",

    "utm_source": "linkedin",
    "utm_medium": "social",
    "page_url": "/blog/iso-27001-vs-soc2",
    "referrer_url": "https://www.linkedin.com/",
    "landing_page": "/blog/iso-27001-vs-soc2",
    "pages_viewed": 1,
    "device_type": "mobile",

    "form_render_ms": 12000,
    "website": ""
  }'
```

Expected: score 5, tier `marketing_drip`, and a `newsletter_subscribers` row created.

---

## 4. Book a demo — highest intent

The full qualification form. Scores highest.

```bash
UUID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')

curl -s -X POST http://localhost:4000/api/forms/demo_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$UUID"'",
    "form_name": "book_a_demo",

    "first_name": "Elena",
    "last_name": "Fischer",
    "email": "elena.fischer@meridian-bank.com",
    "phone": "+49 30 12345678",
    "company_name": "Meridian Bank",
    "job_title": "Chief Information Security Officer",
    "company_size": "1000+",
    "country": "DE",
    "solution_interest": ["compliance_automation", "risk_management"],
    "framework_interest": ["soc2", "iso27001"],
    "message": "We have a SOC 2 Type II audit deadline next month. Need evidence collection automated urgently.",

    "consent_given": true,
    "consent_text_version": "v1",

    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "grc_q4",
    "first_touch_src": "linkedin",
    "page_url": "/demo",
    "referrer_url": "https://www.google.com/",
    "landing_page": "/frameworks/soc2-checklist",
    "session_id": "sess_7fe21b",
    "pages_viewed": 8,
    "visit_count": 3,
    "time_on_site_sec": 840,
    "visited_pricing": true,
    "device_type": "desktop",

    "form_render_ms": 45000,
    "website": ""
  }'
```

Expected: **score 100**, tier `enterprise_ae`, SLA 1 hour out, and jobs queued for
`slack_alert`, `calendar_send` and `ai_extract`.

`company_size` must be one of: `1-50` `51-200` `201-1000` `1000+`

`country` is an ISO 3166-1 alpha-2 code, case-insensitive (`de` becomes `DE`).
**Required on the demo form.** Asked explicitly rather than derived from the IP,
because GRC is jurisdiction-specific and a corporate VPN routinely reports the wrong
country. A declared country always overrides the one derived from the CDN header.

`solution_interest` values: `risk_management` `ai_governance` `compliance_automation`
`not_sure`. At least one required on the demo form — it changes what the demo covers.

`framework_interest` values: `soc2` `iso27001` `hipaa` `gdpr` `pci_dss` `nist`
`fedramp` `iso42001` `eu_ai_act` `other`

---

## 5. Contact us — sales inquiry

```bash
UUID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')

curl -s -X POST http://localhost:4000/api/forms/contact_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$UUID"'",
    "form_name": "contact_us",

    "first_name": "Marcus",
    "last_name": "Webb",
    "email": "marcus.webb@apex-insurance.com",
    "phone": "+1 415 236 7890",
    "company_name": "Apex Insurance",
    "job_title": "VP of Risk and Compliance",
    "inquiry_type": "request_demo",
    "message": "Interested in seeing how you handle ISO 27001 evidence collection.",

    "consent_given": true,
    "page_url": "/contact",
    "pages_viewed": 3,
    "device_type": "desktop",
    "form_render_ms": 60000,
    "website": ""
  }'
```

`inquiry_type` values: `request_demo` `general` `partnership` `support` `media`

---

## 6. Contact us — support (bypasses scoring)

Support, partnership and media skip lead scoring entirely and route straight to a team.

```bash
UUID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')

curl -s -X POST http://localhost:4000/api/forms/contact_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$UUID"'",
    "form_name": "contact_us",

    "first_name": "Tara",
    "last_name": "Whitfield",
    "email": "t.whitfield@orion-logistics.com",
    "phone": "+1 212 555 0147",
    "company_name": "Orion Logistics",
    "job_title": "IT Director",
    "inquiry_type": "support",
    "message": "Existing customer. SSO login failing for three users since yesterday.",

    "form_render_ms": 55000,
    "website": ""
  }'
```

Expected: tier `bypass_support`, status `disqualified` (not a sales lead), **no**
Slack alert.

---

## 7. Simulating the CDN edge

In production Cloudflare supplies the real client IP and country. Without these
headers, `geo_country` stays null and a **national-format phone number will not be
normalised** — the service refuses to guess a country rather than corrupt the number.

```bash
UUID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')

curl -s -X POST http://localhost:4000/api/forms/demo_form/submit \
  -H 'content-type: application/json' \
  -H 'cf-connecting-ip: 88.99.100.50' \
  -H 'cf-ipcountry: DE' \
  -H 'user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' \
  -d '{
    "submission_uuid": "'"$UUID"'",
    "form_name": "book_a_demo",
    "first_name": "Lukas",
    "last_name": "Brandt",
    "email": "lukas@berlin-fintech.de",
    "phone": "030 12345678",
    "company_name": "Berlin Fintech",
    "job_title": "CISO",
    "company_size": "1000+",
    "consent_given": true,
    "form_render_ms": 41000
  }'
```

Expected after the worker runs: `country_code = DE`, `device_type = mobile` (parsed
from the user agent, since none was sent), and `phone_e164 = +493012345678`.

---

## 8. Idempotency

Send the **same** `submission_uuid` twice. The second call returns the same
`submission_id` and creates no second lead.

```bash
UUID=$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')

PAYLOAD='{
  "submission_uuid": "'"$UUID"'",
  "form_name": "site_footer",
  "email": "duplicate.test@acme-corp.com",
  "consent_given": true
}'

echo "--- first ---"
curl -s -X POST http://localhost:4000/api/forms/footer_form/submit \
  -H 'content-type: application/json' -d "$PAYLOAD"

echo; echo "--- replay ---"
curl -s -X POST http://localhost:4000/api/forms/footer_form/submit \
  -H 'content-type: application/json' -d "$PAYLOAD"
```

Both return an identical `submission_id`.

---

## 9. Error cases

### Missing required fields → 400

```bash
curl -s -X POST http://localhost:4000/api/forms/demo_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')"'",
    "email": "incomplete@acme-corp.com"
  }'
```

```json
{
  "ok": false,
  "error": "validation_failed",
  "message": "Some fields need attention",
  "fields": {
    "first_name": ["Required"],
    "last_name": ["Required"],
    "phone": ["Required"],
    "company_name": ["Required"],
    "job_title": ["Required"],
    "company_size": ["Required"]
  }
}
```

### Personal email on a lead form → 400

```bash
curl -s -X POST http://localhost:4000/api/forms/demo_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')"'",
    "first_name": "Test", "last_name": "User",
    "email": "someone@gmail.com",
    "phone": "+12124567890",
    "company_name": "Test Co",
    "job_title": "CISO",
    "company_size": "1000+"
  }'
```

```json
{
  "ok": false,
  "error": "personal_email",
  "message": "Please use your work email address",
  "fields": { "email": ["A business email address is required"] }
}
```

### Unknown form template → 404

```bash
curl -s -X POST http://localhost:4000/api/forms/not_a_form/submit \
  -H 'content-type: application/json' -d '{}'
```

### Rate limited → 429

Send the same request six times within an hour.

```json
{ "ok": false, "error": "rate_limited", "message": "Too many submissions. Please try again later." }
```

---

## 10. Anti-bot

All of these return `200` with a normal `submission_id`. That is deliberate — telling
a bot it was detected only helps it. The row is stored with `is_suspected_bot = 1` and
generates **no automation jobs**.

### Honeypot filled

`website` is a hidden input a real browser never fills.

```bash
curl -s -X POST http://localhost:4000/api/forms/quick_capture/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')"'",
    "full_name": "Bot Bot",
    "email": "bot@spam-farm.biz",
    "company_name": "SpamFarm",
    "website": "http://spam.example",
    "form_render_ms": 30000
  }'
```

### Submitted too fast

Under `MIN_SUBMIT_SECONDS` (default 3s) is faster than a human can type.

```bash
curl -s -X POST http://localhost:4000/api/forms/quick_capture/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')"'",
    "full_name": "Fast Bot",
    "email": "fast@speedy-domain.com",
    "company_name": "Speedy",
    "form_render_ms": 800
  }'
```

### Server-owned field injection

`lead_score`, `assigned_to` and `routing_tier` are stripped before validation.

```bash
curl -s -X POST http://localhost:4000/api/forms/footer_form/submit \
  -H 'content-type: application/json' \
  -d '{
    "submission_uuid": "'"$(powershell -Command "[guid]::NewGuid().ToString()" | tr -d '\r')"'",
    "email": "attacker@evil-corp.com",
    "lead_score": 100,
    "assigned_to": "ceo@company.com",
    "routing_tier": "enterprise_ae"
  }'
```

Returns `200`, but the lead lands at score 5 / `marketing_drip` / `marketing@queue`.

---

## 11. Newsletter unsubscribe

Get a token first:

```bash
npx prisma studio    # newsletter_subscribers → unsubscribe_token
```

### One-click (redirects)

```bash
curl -s -i "http://localhost:4000/api/newsletter/unsubscribe?token=PASTE_TOKEN_HERE"
```

### JSON

```bash
curl -s -X POST http://localhost:4000/api/newsletter/unsubscribe \
  -H 'content-type: application/json' \
  -d '{ "token": "PASTE_TOKEN_HERE" }'
```

An unknown token still returns success — telling someone "that link is invalid" when
they are trying to leave is hostile and a compliance risk.

### Resubscribe

```bash
curl -s -X POST http://localhost:4000/api/newsletter/resubscribe \
  -H 'content-type: application/json' \
  -d '{ "token": "PASTE_TOKEN_HERE" }'
```

Bounced and complained addresses are **not** resubscribed by a link click — re-mailing
a complained address damages sending reputation for everyone.

---

## Checking results

```bash
npx prisma studio        # browse leads, submissions, jobs, automation_events
curl -s http://localhost:4000/health    # queue depth
```

A rising `pending` count means the worker is behind. Any `dead` count needs a human.
