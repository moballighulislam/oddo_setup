# Setup guides — deepnotch.ai

Everything needed to take this from local code to a live site, assuming you start
with **only a domain and frontend source code**.

Work through them in order. Each guide says what to click, what it costs, and what to
hand back.

---

## The guides

| # | Guide | Who | Time | Cost |
|---|---|---|---|---|
| 01 | [Domain & DNS](./01-domain-and-dns.md) | You | 30 min | £0 |
| 02 | [Email provider](./02-email-provider.md) | You | 30 min | £0 |
| 03 | [reCAPTCHA](./03-recaptcha.md) | You | 10 min | £0 |
| 04 | [Database](./04-database.md) | You | 20 min | £0–15/mo |
| 05 | [Backend hosting](./05-backend-hosting.md) | You + me | 45 min | £0–10/mo |
| 06 | [Frontend hosting](./06-frontend-hosting.md) | You | 30 min | £0 |
| 07 | [Connecting them](./07-connect-frontend-backend.md) | Me | 30 min | £0 |
| 08 | [Slack & calendar](./08-slack-and-calendar.md) | You | 15 min | £0 |
| 09 | [Go-live checklist](./09-go-live-checklist.md) | Both | 1 hr | — |
| 10 | [Odoo CRM](./10-odoo-crm.md) | You | 45 min | £0 |
| 11 | [CRM process design](./11-crm-process.md) | You | 20 min | £0 |

**Total: roughly 5 hours of your time, £0–25/month.**

Guides 10 and 11 can be done any time — the CRM is independent of launch. **Read 11
before configuring Odoo in 10**: it decides what the pipeline is for, and the
configuration follows from that.

---

## Order and what blocks what

```
01 Domain & DNS  ⛔ blocks everything
      │
      ├──> 02 Email provider   (DNS verification can take time — start it early)
      ├──> 03 reCAPTCHA
      │
      ├──> 04 Database ──> 05 Backend hosting ──┐
      │                                          ├──> 07 Connect ──> 09 Go live
      └──> 06 Frontend hosting ──────────────────┘

08 Slack & calendar — any time, optional
```

**Guides 02, 04 and 06 can run in parallel.** Start 02 first regardless — domain
verification is the step most likely to stall on something outside your control.

---

## What you end up with

| Piece | Service | What it does |
|---|---|---|
| Domain | You already own `deepnotch.ai` | The name |
| DNS | Cloudflare (free) | Routes traffic, holds email records, supplies visitor country |
| Frontend | Vercel (free) | The marketing site |
| Backend | Railway (~$5/mo) | This API + the background worker |
| Database | Railway MySQL (~$5/mo) | Leads, submissions, jobs |
| Email | Resend (free) | Confirmation emails |
| Anti-bot | reCAPTCHA v3 (free) | Spam filtering |

Final layout:

```
deepnotch.ai         → frontend (Vercel)
www.deepnotch.ai     → frontend (Vercel)
api.deepnotch.ai     → this backend (Railway)
```

---

## Credentials to collect

Keep these somewhere safe as you go. I need all of them to configure production:

```bash
# 02 — Email
EMAIL_PROVIDER_API_KEY=
EMAIL_FROM_ADDRESS=noreply@deepnotch.ai

# 03 — Anti-bot
RECAPTCHA_SECRET_KEY=          # backend — give to me
# RECAPTCHA site key           # frontend — give to whoever builds the forms

# 04 — Database
DATABASE_URL=

# 07 — Wiring
CORS_ORIGINS=https://deepnotch.ai,https://www.deepnotch.ai
PUBLIC_API_URL=https://api.deepnotch.ai
PUBLIC_APP_URL=https://deepnotch.ai

# 08 — Optional
SLACK_WEBHOOK_URL=
CALENDAR_BOOKING_URL=
```

⚠️ **Never commit these.** `.env` is gitignored. Send them to me over something that
isn't a public channel, and if a key is ever pasted somewhere public, rotate it
immediately rather than hoping.

---

## Why each piece is separate

A common assumption is that buying hosting covers all of this. It doesn't:

- **Hosting runs your code.** It does not deliver email — shared hosting's "free
  email" means mailboxes a human reads, not programmatic sending. Sending through it
  lands your confirmations in spam.
- **DNS is not hosting.** It's the phone book pointing your name at servers. It's
  free and usually lives with your registrar or Cloudflare.
- **Frontend and backend hosting are different shapes.** The frontend is static files
  on a CDN. This backend is a long-running Node process with a database and a
  background worker — shared/cPanel hosting cannot run it at all.

---

## If you get stuck

Each guide has a troubleshooting section at the bottom. The two that stall people
most often:

1. **DNS not verifying** — almost always propagation. Wait 15 minutes, retry.
2. **CORS errors in the browser** — the origin must match exactly, including
   `https://` and whether `www.` is present. Covered in guide 07.
