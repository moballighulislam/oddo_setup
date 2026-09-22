# 09 — Go-live checklist

**Who:** both · **Time:** 1 hr · **Needs:** guides 01–07

Final verification before real traffic.

---

## Pre-flight

### Infrastructure

- [ ] `deepnotch.ai` loads over HTTPS with a valid certificate
- [ ] `www.deepnotch.ai` redirects to the canonical domain
- [ ] `api.deepnotch.ai/health` returns 200 with `"env": "production"`
- [ ] Cloudflare SSL/TLS set to **Full (strict)**
- [ ] Cloudflare proxy **on** for `@`, `www`, `api`
- [ ] Cloudflare proxy **off** for every mail record

### Configuration

- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGINS` lists exact production origins, no `*`
- [ ] `RECAPTCHA_SECRET_KEY` set — production won't boot without it
- [ ] `EMAIL_PROVIDER_API_KEY` and `EMAIL_FROM_ADDRESS` set
- [ ] `DATABASE_URL` points at MySQL, not SQLite
- [ ] `RUN_WORKER=true`
- [ ] `RATE_LIMIT_MAX=5`
- [ ] No `.env` file in Git — `git log --all --full-history -- "**/.env"` prints nothing

### Database

- [ ] Migrations applied to production
- [ ] Automatic backups on, retention window known
- [ ] A restore has been tested once — an untested backup is a hope
- [ ] Not publicly reachable
- [ ] Seed data removed: `DELETE FROM leads WHERE email LIKE '%@acme-corp.com'`

### Email

- [ ] Domain verified with the provider
- [ ] Test email lands in inbox, not spam
- [ ] DMARC record present
- [ ] Unsubscribe link in the footer resolves and works

---

## Live tests

Run these against production, then delete the test rows.

### 1. Each form submits

Submit all four from the real site. Each should return `{ ok: true }` and appear in the
database within seconds.

- [ ] Quick capture
- [ ] Footer
- [ ] Demo
- [ ] Contact

### 2. A high-value lead routes correctly

Submit a demo form as a CISO at a 1000+ company.

- [ ] `lead_score` ≥ 80
- [ ] `routing_tier` = `enterprise_ae`
- [ ] `sla_due_at` roughly one hour out
- [ ] Slack alert arrived
- [ ] Confirmation email arrived with the booking link

### 3. The support bypass works

Contact form with `inquiry_type: support`.

- [ ] `routing_tier` = `bypass_support`
- [ ] `lead_status` = `disqualified`
- [ ] **No** Slack alert

### 4. Anti-bot holds

- [ ] Honeypot filled → stored, `is_suspected_bot = 1`, **no** email sent
- [ ] Submitted under 3 seconds → flagged `too_fast`
- [ ] Six submissions in an hour → sixth returns 429

### 5. Idempotency

- [ ] Double-click submit → one lead, not two

### 6. Consent and unsubscribe

- [ ] Consent ticked → `consent_given`, `consent_ip`, `consent_at` all populated
- [ ] Unsubscribe link sets status to `unsubscribed`
- [ ] Re-submitting a form does **not** resurrect an unsubscribed person

### 7. Cleanup

```sql
DELETE FROM leads WHERE email LIKE '%test%' OR email LIKE '%@acme-corp.com';
```

Cascades handle submissions, tracking, scores and events.

---

## Day one monitoring

### Watch

```bash
curl https://api.deepnotch.ai/health
```

| Signal | Meaning |
|---|---|
| `pending` climbing | Worker is behind or stopped |
| `dead` > 0 | A job exhausted its retries — someone must look |
| `failed` > 0 briefly | Normal, it's retrying |

### Check after the first day

```sql
-- Are real leads being flagged as bots?
SELECT is_suspected_bot, bot_reason, COUNT(*)
FROM form_submissions GROUP BY 1, 2;

-- Is the score distribution sensible?
SELECT routing_tier, COUNT(*), AVG(lead_score)
FROM leads GROUP BY 1;

-- Did any automation fail?
SELECT event_type, status, COUNT(*)
FROM automation_events GROUP BY 1, 2;
```

If real leads are landing in `is_suspected_bot`, lower `RECAPTCHA_SCORE_THRESHOLD`.
Because flagged rows are stored rather than dropped, nothing is lost — you can review
and reprocess them.

---

## Known gaps at launch

Be clear-eyed about what is not covered on day one.

| Gap | Impact | Mitigation |
|---|---|---|
| **No alerting on dead jobs** | A failed CRM push or email is recorded but nobody is told | Check `/health` daily until built |
| **Rate limit is in-memory** | Limit multiplies per replica | Run a single instance for now |
| **No admin UI** | Leads only visible via Prisma Studio or SQL | Acceptable at low volume |
| **No CRM** | Leads live only in this database | The `crm_push` job is ready when a vendor is chosen |
| **No Layers 2–5** | No nurture sequences yet | Layer 1 is what stops leads going unnoticed |
| **`geo_region`/`geo_city` empty** | Country works, finer geo doesn't | Needs MaxMind |

None of these lose data. The one that would — a lead arriving unnoticed — is solved
by Layer 1 as long as email and Slack are configured.

---

## Rollback

If something goes badly wrong:

1. **Frontend** — Vercel keeps every deployment; promote the previous one
2. **Backend** — Railway keeps deployment history; redeploy the last good one
3. **Database** — restore from backup. This loses leads submitted since the snapshot,
   so try to fix forward first
4. **Emergency stop on sending** — clear `EMAIL_PROVIDER_API_KEY` and redeploy. Jobs
   revert to simulated mode: they log instead of sending, and nothing is lost

Point 4 is worth remembering. If a bug starts sending wrong emails, removing the key
stops it immediately without taking the site down or losing submissions.

---

## After launch

In order of value:

1. **Alerting on dead jobs** — the biggest blind spot
2. **CRM decision** — unblocks Layer 2
3. **Layer 5 email cadence** — needs unsubscribe suppression and SMS consent resolved
4. **Admin API** — so the team can see leads without database access
5. **MaxMind** — finer geolocation

Full list in `docs/TRACKER.md`.

---

## Sign-off

- [ ] All pre-flight checks passed
- [ ] All seven live tests passed
- [ ] Test data deleted
- [ ] Someone owns checking `/health` daily until alerting exists
- [ ] Team knows leads currently live in the database, not a CRM

**Live.**
