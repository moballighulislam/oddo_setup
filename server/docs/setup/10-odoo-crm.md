# 10 — Odoo CRM

**Who:** you (account) + me (integration) · **Time:** 45 min · **Cost:** £0
**Needs:** guide 01

Goal: leads pushed automatically into Odoo CRM as they arrive.

---

## Cost

**£0.** Odoo's *One App Free* plan gives you **one app, unlimited users, free forever**
on Odoo Online — hosting, maintenance and upgrades included.

⚠️ **The catch that matters:** the moment you install a **second** app — Sales,
Invoicing, Accounting, anything — you move onto a paid plan. If free matters, install
CRM and nothing else. Odoo will suggest other apps repeatedly; each one ends the free
tier.

---

## Step 1 — Create the instance (10 min)

1. [odoo.com/trial](https://www.odoo.com/trial)
2. Select **CRM** — and only CRM
3. Fill in company details
4. Choose your database name, e.g. `deepnotch`

You get a URL like `https://deepnotch.odoo.com`.

Note both:

| Thing | Example |
|---|---|
| **URL** | `https://deepnotch.odoo.com` |
| **Database name** | `deepnotch` — usually the subdomain |

The database name is often not obvious. Confirm it at
`https://deepnotch.odoo.com/web/database/selector`, or in **Settings → General
Settings → Developer Tools → Activate developer mode**, after which it shows in the
top bar.

---

## Step 2 — Create an integration user (10 min)

Do **not** use your personal admin login for the API.

Reasons: when that person leaves, the integration breaks; every lead shows as created
by a human who didn't create it; and an admin-scoped key is far more dangerous if
leaked.

1. **Settings → Users & Companies → Users → New**
2. Name: `Backend Integration`
3. Email: `integration@deepnotch.ai`
4. Access Rights → **Sales / CRM: User** — not Administrator
5. Save

> On the free plan a portal/internal user still counts against nothing — One App Free
> has unlimited users, so this costs nothing.

---

## Step 3 — Generate an API key (5 min)

Log in **as the integration user** (or use "Log in as" from the admin user list).

1. Click the avatar → **My Profile** (or **Preferences**)
2. **Account Security** tab
3. **New API Key**
4. Description: `dn-backend`
5. Copy it

> Odoo shows the key **once**. It is equivalent to a password — if you lose it, you
> generate a new one rather than recovering it.

---

## Step 4 — Configure the pipeline (10 min)

**CRM → Configuration → Stages**

The default stages are New → Qualified → Proposition → Won. That works. If you change
them, tell me the name of the first stage — new leads land there.

### Sales team

**CRM → Configuration → Sales Teams**

Create one (e.g. `Inbound`) or use the default. The integration assigns leads to a
team; without one they land unassigned and are easy to miss.

### Optional: tags

**CRM → Configuration → Tags**

The integration creates tags automatically for frameworks (`soc2`, `iso27001`, …) and
the routing tier. Nothing to set up — this is just where they appear.

---

## Step 5 — Hand over

```bash
ODOO_URL=https://deepnotch.odoo.com
ODOO_DB=deepnotch
ODOO_USERNAME=integration@deepnotch.ai
ODOO_API_KEY=xxxxxxxxxxxxxxxxxxxx
ODOO_SALES_TEAM=Inbound          # optional
```

Send these privately. The API key is a credential.

---

## What I build

The `crm_push` job already exists and runs on every submission — it currently logs
"would push". Wiring Odoo means implementing one function.

### Field mapping

| Our field | Odoo field | Notes |
|---|---|---|
| — | `name` | Opportunity title, built from company + form |
| `first_name` + `last_name` | `contact_name` | |
| `email` | `email_from` | |
| `phone_e164` | `phone` | |
| `company_name` | `partner_name` | |
| `job_title` | `function` | |
| `lead_score` | `priority` | 80+ → ⭐⭐⭐, 50–79 → ⭐⭐, 30–49 → ⭐, else none |
| `routing_tier` | `tag_ids` | As a tag |
| `framework_interest` | `tag_ids` | One tag per framework |
| `utm_source` | `source_id` | Odoo has native UTM models |
| `utm_medium` | `medium_id` | |
| `utm_campaign` | `campaign_id` | |
| `country_code` | `country_id` | |
| message + score breakdown | `description` | So an SDR sees *why* it scored what it did |

Odoo has native UTM tracking (`utm.source`, `utm.medium`, `utm.campaign`), so
attribution carries across properly rather than being flattened into a text note.

### Deduplication

Odoo gets searched by email before creating. An existing open opportunity is
**updated**, not duplicated — so a lead who subscribes and later books a demo stays
one record with a rising score.

The Odoo record id is stored on our side, so a retry after a timeout cannot create a
second copy.

### Failure handling

`crm_push` has the **highest retry budget in the system — 8 attempts** with
exponential backoff. A lead that never reaches the CRM is invisible to sales, which is
the worst outcome the system can produce. If all 8 fail the job goes `dead` and stays
in the table as a record of what needs fixing.

---

## Step 6 — Verify

Once wired:

1. Submit a demo form on the live site
2. **CRM → Pipeline** — the opportunity appears within seconds
3. Check: contact details, ⭐⭐⭐ priority, tags for tier and frameworks, UTM fields
   populated, description showing the score breakdown

---

## Done when

- [ ] Odoo instance created with **CRM only** — no second app installed
- [ ] Integration user created with Sales/CRM User rights, not admin
- [ ] API key generated and stored
- [ ] Pipeline stages confirmed
- [ ] Sales team created
- [ ] Credentials handed over

---

## Troubleshooting

**"Access Denied" on API calls**
Almost always the database name rather than the key. Confirm it at
`/web/database/selector`.

**Leads appear but unassigned**
No sales team matched `ODOO_SALES_TEAM`. The name must match exactly.

**"I got upgraded to a paid plan"**
A second app was installed — often by clicking a suggestion in the Odoo UI. Uninstall
it from **Apps** to return to One App Free.

**Can we self-host instead?**
Yes. Odoo Community is open source and free, on your own server. The integration is
identical — only `ODOO_URL` changes. It costs hosting and maintenance instead of £0,
so it's only worth it if company policy requires owning the data.

---

## Why Odoo changes the plan

The tracker previously listed Layer 2 (nurture branching) as blocked on the CRM
decision. It no longer is.

But note what Odoo does **not** solve: on the free One App plan you have CRM only —
**no email marketing app**. So the Layer 5 nurture cadence still runs from this backend
through Resend, not from Odoo. Installing Odoo's Email Marketing app would end the
free tier.

That is fine — the job queue already handles scheduled sends. It just means Odoo is
the pipeline, and this backend remains the sender.
