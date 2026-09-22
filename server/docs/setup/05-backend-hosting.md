# 05 — Backend hosting

**Who:** you (account) + me (deploy) · **Time:** 45 min · **Cost:** £0–10/mo
**Needs:** guides 01, 04

Goal: this API running at `api.deepnotch.ai`.

---

## What this backend actually is

Important, because it rules out the cheapest hosting:

- A **long-running Node.js process** — not PHP, not static files
- A **background worker** polling a job queue, which must keep running between requests
- A **database connection pool**
- Graceful shutdown handling, so a deploy doesn't kill an in-flight form submission

**Shared/cPanel hosting cannot run this.** GoDaddy, Hostinger, Bluehost and similar
run PHP and kill long-running processes. There is no configuration that makes it work.

---

## Options

| Option | Cost | Notes |
|---|---|---|
| **Railway** ✅ | ~$5/mo | Simplest. Database and app in one project, private networking between them |
| Render | free–$7/mo | Free tier **sleeps when idle** — queued jobs stall until the next request wakes it. Fine for staging, not production |
| Fly.io | ~$5/mo | Good if you want specific regions |
| AWS EC2 / ECS | ~$10/mo+ | If company policy requires own infrastructure. Most setup work |
| Vercel | — | ❌ **Will not work.** Serverless functions cannot run a persistent background worker |

**Recommendation: Railway.** You're likely already there from guide 04, and the app
reaches the database over private networking rather than the public internet.

> ⚠️ Vercel is excellent for the frontend (guide 06) and unsuitable here. Serverless
> functions are killed after each request; this backend needs a process that stays
> alive to drain the job queue.

---

## Step 1 — Get the code into Git (10 min)

Railway deploys from a repository.

```bash
cd server
git init
git add .
git commit -m "dn-backend: form intake, scoring, routing, job queue"
```

Push to a **private** repo — this is lead-handling code.

Check nothing sensitive is staged:

```bash
git status --porcelain | grep -E '\.env$|\.db$'
```

That should print nothing. `.gitignore` already covers `.env` and `*.db`, but verify —
a leaked API key in Git history is painful to remove properly.

---

## Step 2 — Create the service (5 min)

1. Railway → your project (the one with MySQL from guide 04)
2. **New** → **GitHub Repo** → select it
3. **Settings** → **Root Directory** → `server` if the repo root contains both
   frontend and backend

---

## Step 3 — Environment variables (10 min)

Railway → service → **Variables**:

```bash
NODE_ENV=production
PORT=4000
LOG_LEVEL=info

DATABASE_URL=${{MySQL.MYSQL_URL}}    # Railway reference — keeps it private

CORS_ORIGINS=https://deepnotch.ai,https://www.deepnotch.ai
PUBLIC_APP_URL=https://deepnotch.ai
PUBLIC_API_URL=https://api.deepnotch.ai

EMAIL_PROVIDER_API_KEY=re_xxxxx      # guide 02
EMAIL_FROM_ADDRESS=noreply@deepnotch.ai
RECAPTCHA_SECRET_KEY=6Lxxxxx         # guide 03

RATE_LIMIT_MAX=5
RATE_LIMIT_WINDOW=1 hour
RUN_WORKER=true
```

`${{MySQL.MYSQL_URL}}` is Railway's variable reference — it wires the database
privately rather than pasting a public connection string.

**Two guards that will stop a bad deploy**, by design:

- Missing `RECAPTCHA_SECRET_KEY` in production → the process refuses to start
- `CORS_ORIGINS` containing `*` in production → refuses to start

Better a failed deploy than a form endpoint anyone can post to from any origin.

---

## Step 4 — Custom domain (5 min)

1. Railway → service → **Settings** → **Networking** → **Custom Domain**
2. Enter `api.deepnotch.ai`
3. Railway gives you a CNAME target

In Cloudflare → **DNS** → **Add record**:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `api` |
| Target | *(from Railway)* |
| Proxy | 🟠 **Proxied** |

**Proxy on here, unlike the mail records.** That's what supplies `cf-connecting-ip`
and `cf-ipcountry` — the headers that make geolocation and international phone
normalisation work.

---

## Step 5 — What I do

- [ ] Dockerfile
- [ ] Migrations run on deploy
- [ ] Health check wired to `/health` so a failed deploy rolls back
- [ ] Verify graceful shutdown drains in-flight jobs
- [ ] Deploy and smoke-test every endpoint

---

## Step 6 — Verify

```bash
curl https://api.deepnotch.ai/health
```

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "queue": { "pending": 0, "running": 0, "succeeded": 0, "failed": 0, "dead": 0 }
  },
  "env": "production"
}
```

`"env": "production"` confirms the guards are active.

---

## Done when

- [ ] Code in a private Git repo, no `.env` committed
- [ ] Service deployed, `/health` returns 200
- [ ] `api.deepnotch.ai` resolves with a valid certificate
- [ ] Cloudflare proxy **on** for the `api` record
- [ ] All environment variables set

**Next:** [06 — Frontend hosting](./06-frontend-hosting.md)

---

## Monitoring

`/health` reports queue depth. Two signals:

- **`pending` climbing** — the worker is behind, or has stopped
- **`dead` above zero** — a job exhausted its retries. Someone needs to look

Alerting on `dead` isn't built yet. It's on my list and independent of everything else.

---

## Troubleshooting

**Deploy fails immediately with no logs**
Usually the env guard doing its job — check `RECAPTCHA_SECRET_KEY` is set and
`CORS_ORIGINS` has no `*`. The error prints the exact variable.

**`/health` returns 503**
Database unreachable. Check `DATABASE_URL`, and that the app and database are in the
same Railway project if you're using the `${{...}}` reference.

**Jobs queue up but never run**
`RUN_WORKER` isn't `true`, or you're on a free tier that sleeps when idle. Render's
free tier does this — the queue stalls until traffic wakes the service.

**Can I run this on the same server as the frontend?**
Technically yes, on a VPS. Not recommended: a frontend deploy would restart the
backend and interrupt in-flight submissions. Keep them separate.
