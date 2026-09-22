# 04 — Database

**Who:** you (create) + me (migrate) · **Time:** 20 min · **Cost:** £0–15/mo

Goal: a managed MySQL database for production.

---

## Why now, not later

Development runs on SQLite — a single file, `prisma/dev.db`. That's right for building
and wrong for production: one writer at a time, no network access, no backups, and it
disappears when the container restarts.

**Do this before launch.** Migrating an empty database is a schema change. Migrating
one with real leads in it is a data migration with downtime and a risk of losing
records. The cost difference is hours versus minutes.

---

## Options

| Option | Cost | Backups | Best when |
|---|---|---|---|
| **Railway MySQL** ✅ | ~$5/mo | Automatic | You'll host the backend on Railway too — one dashboard, private networking |
| PlanetScale | Free tier | Automatic | You want branching workflows |
| AWS RDS | ~$15/mo | Configurable | Acefone already runs AWS and policy requires it |
| Self-managed on a VPS | Included | **Your problem** | Cheapest, most work |

**Recommendation: Railway**, created alongside the backend in guide 05. The app and
database talk over private networking, so the database is never exposed to the
internet.

If your company requires infrastructure on its own AWS account, use RDS — everything
else in these guides still applies.

---

## Step 1 — Create it (10 min)

On Railway:

1. [railway.app](https://railway.app) → sign in with GitHub
2. **New Project** → **Provision MySQL**
3. Wait ~30 seconds
4. Click the MySQL service → **Variables** → copy `MYSQL_URL`

It looks like:

```
mysql://root:PASSWORD@containers-xxx.railway.app:1234/railway
```

That string is a credential. Treat it like a password.

---

## Step 2 — Hand over

```bash
DATABASE_URL=mysql://root:xxxxx@xxxxx.railway.app:1234/railway
```

---

## Step 3 — What I do

Currently the schema avoids everything SQLite cannot express. The switch is mostly
mechanical:

| Now (SQLite) | After (MySQL) | Why |
|---|---|---|
| `String` columns for enums | Native `enum` | **The database starts rejecting bad values.** Today `src/schemas/enums.ts` is the *only* enforcement |
| `String` holding JSON | `@db.Json` | Queryable |
| `Int` primary keys | `BigInt UNSIGNED` | Headroom |
| Prisma default lengths | `@db.VarChar(n)` / `@db.Text` | Index efficiency |

Then regenerate migrations and re-run the full suite.

The enum change is the meaningful one. On SQLite a bad `form_id` is written happily
and only Zod stands in the way. On MySQL the database refuses it.

**Half a day.** The schema was written with this in mind.

---

## Step 4 — Backups

Railway and PlanetScale back up automatically. Confirm it's on and note the retention
window.

If self-managing, set up `mysqldump` on a schedule **before** launch. A lead database
with no backup is one bad command from gone.

Worth testing a restore once. An untested backup is a hope, not a backup.

---

## What ends up in there

| Table | Grows with | Notes |
|---|---|---|
| `leads` | Unique people | One row per email, ever |
| `form_submissions` | Every submit | Includes `raw_payload`, the largest column |
| `tracking_data` | Every submit | 1:1 with submissions |
| `lead_scores` | Every submit × ~4 | **Fastest-growing table** |
| `newsletter_subscribers` | Subscribers | Small |
| `automation_events` | Every automation | ~6 rows per submission |
| `jobs` | Every automation | Succeeded rows pruned after 7 days |

Rough sizing: 1,000 submissions/month ≈ **50–100 MB/year**. Comfortably inside any
free or entry tier for years.

---

## Done when

- [ ] MySQL database created
- [ ] Connection string handed over
- [ ] Automatic backups confirmed on
- [ ] Not publicly exposed (private networking, or firewalled to the app only)

**Next:** [05 — Backend hosting](./05-backend-hosting.md)

---

## Troubleshooting

**"Can I just use SQLite in production?"**
No. One writer at a time, and on most hosts the filesystem is ephemeral — a redeploy
wipes it. You would lose every lead on the next deploy.

**"Do I need MySQL specifically? Postgres is better."**
Postgres is arguably the better fit — `JSONB` in particular. But MySQL was your call,
the schema is written for it, and it handles this workload without difficulty. Not
worth revisiting unless you want to.

**"Database connection failed"**
Check the host allows external connections (Railway does by default), the string is
complete including the port, and the password wasn't truncated in copying.
