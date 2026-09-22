# 11 — CRM process design (startup)

**Who:** you · **Time:** 45 min · **Cost:** £0 · **Needs:** guide 10

Read this **before** configuring Odoo. It defines what the CRM is actually for, so the
configuration follows a decision rather than a default.

---

## The governing principle

You are a startup with no SDR team. Most CRM advice assumes a sales org that doesn't
exist yet, and copying it produces an elaborate pipeline nobody maintains — which is
worse than a simple one that gets used.

**Set up the smallest thing that answers three questions:**

1. Who do I need to contact today?
2. What happened last time I contacted them?
3. Which deals might actually close?

Everything else is premature. Odoo makes stages, teams and automation easy to add
later — but a stage nobody updates is worse than no stage, because it makes the
pipeline lie.

---

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| SDR / AE split | **None — one queue** | You don't have two roles. A fake split creates leads nobody owns |
| Non-sales inquiries | **Not in the pipeline** | Support, partnership and media aren't deals. Slack + database is enough |
| Repeat submitters | **Update the existing record** | One person, one record. Score rises, note logged |
| Leads vs Opportunities | **Both, split by tier** | Keeps the pipeline meaningful |

---

## What reaches Odoo, and how

The backend scores and routes before anything is pushed. Odoo doesn't re-qualify.

| Tier | Score | Odoo | Why |
|---|---|---|---|
| `enterprise_ae` | 80–100 | **Opportunity** — pipeline, New stage | Real deal, work it today |
| `sdr` | 50–79 | **Opportunity** — pipeline, New stage | Real deal, work it this week |
| `nurture` | 30–49 | **Lead** — not in pipeline | Might become real. Don't forecast it |
| `marketing_drip` | 0–29 | **Lead** — not in pipeline | Newsletter subscriber |
| `bypass_*` | — | **Not pushed** | Not sales |

**This split is the single most important part of the setup.**

If everything lands in the pipeline, the pipeline fills with newsletter subscribers,
your forecast becomes fiction, and within a month you stop opening it. Leads sit in a
separate list you review weekly. Opportunities are things you're actually working.

> Odoo hides the Leads stage by default. Turn it on:
> **CRM → Configuration → Settings → Leads** ✅

---

## Pipeline stages

Six stages. Each represents **a thing that happened**, not a feeling about the deal.

| # | Stage | Enter when | Exit when |
|---|---|---|---|
| 1 | **New** | Integration created it | You've attempted contact |
| 2 | **Contacted** | You emailed or called | They replied |
| 3 | **Qualified** | They replied and have a real need | A demo is booked |
| 4 | **Demo Booked** | Meeting in the calendar | Demo happened |
| 5 | **Proposal** | Pricing sent | They decide |
| 6 | **Won** / **Lost** | Signed / dead | — |

**Why not fewer:** with three stages you can't tell "emailed, no reply" from "had a
great call". Those need completely different follow-up.

**Why not more:** every stage is manual upkeep. Six is what one person maintains
honestly.

**The rule that keeps it useful:** a stage advances only on **their** action, never
your optimism. "I sent a really good email" is still Contacted.

---

## Priority stars

The integration sets Odoo's priority from the score:

| Score | Odoo | Meaning |
|---|---|---|
| 80–100 | ⭐⭐⭐ | Contact today |
| 50–79 | ⭐⭐ | Contact this week |
| 30–49 | ⭐ | Nurture |
| 0–29 | — | Newsletter |

Solo, this replaces routing entirely. You don't need assignment rules when there's one
person — you need to know **what to open first**. Sort the pipeline by priority and
work top-down.

---

## SLA as an activity

The backend computes `sla_due_at` — 1 hour for 80+, 4 hours for 50–79. The integration
creates a scheduled **Activity** in Odoo with that deadline.

This matters because Odoo shows overdue activities in **red** on the dashboard. An SLA
that lives only in a database column is a number nobody sees; an overdue activity is
visible every time you open the CRM.

| Score | Activity | Deadline |
|---|---|---|
| 80–100 | Call | 1 hour |
| 50–79 | Email | 4 hours |
| Below | None | — |

Solo you will miss some. That's fine — the point is knowing you missed it.

---

## Lost reasons

Configure these before launch. Without them everything gets marked "Not interested" and
you learn nothing about why you're losing.

**CRM → Configuration → Lost Reasons**

| Reason | Tells you |
|---|---|
| No budget | Pricing or targeting problem |
| Bad timing — no audit due | Follow-up in 6 months, not dead |
| Chose a competitor | **Ask which one.** The most valuable data you will collect** |
| No response | Your outreach, not their interest |
| Not a fit — too small | Refine targeting |
| Already has a GRC tool | Displacement sale, different motion |
| Duplicate | Data hygiene |

"Bad timing" and "Chose a competitor" are the two worth tracking obsessively. The first
is a future pipeline you can schedule. The second tells you what you're actually
competing against.

---

## Tags

Created automatically by the integration:

- **Framework** — `soc2`, `iso27001`, `hipaa`, `gdpr`, … from the form or parsed from
  their message
- **Tier** — `enterprise_ae`, `sdr`, `nurture`
- **Source** — which form they used

Framework tags are the useful ones. "Show me everyone who mentioned SOC 2" is how you
decide what content to write next.

---

## Your weekly routine

The process only works if it's small enough to actually do.

**Daily (10 min)** — open the pipeline sorted by priority. Work every ⭐⭐⭐. Clear
overdue activities.

**Weekly (30 min)** — review the Leads list (nurture tier) for anyone who re-engaged.
Move stale opportunities to Lost with a reason. Check the CRM count matches the
database.

**Monthly (1 hr)** — review lost reasons for patterns. Check whether scoring matches
reality: are your ⭐⭐⭐ leads actually the ones converting? If not, tell me and I'll
adjust the weights.

That last one is the feedback loop that makes scoring worth having. The model is a
guess until real outcomes correct it.

---

## Odoo configuration checklist

In order:

- [ ] **Settings → CRM → enable Leads** ⚠️ off by default; the whole split depends on it
- [ ] **Configuration → Sales Teams** — create one, `Inbound`. Just one
- [ ] **Configuration → Stages** — set the six above, in order
- [ ] Assign all stages to the `Inbound` team
- [ ] **Configuration → Lost Reasons** — add the seven above
- [ ] **Settings → Users** — create the `Backend Integration` user (guide 10)
- [ ] Confirm you are the default salesperson for the Inbound team

**Don't set up yet:** email templates, automated actions, scoring rules, multiple
teams, or sales targets. Odoo has all of it and none of it earns its keep at zero
customers.

---

## What I build once this is configured

- Create Opportunity for `enterprise_ae` / `sdr`, Lead for `nurture` /
  `marketing_drip`
- Skip `bypass_*` entirely
- Search by email first — update rather than duplicate
- Priority stars from score
- Scheduled activity from `sla_due_at`
- Framework, tier and source tags
- Native UTM mapping (`source_id`, `medium_id`, `campaign_id`)
- Score breakdown in the description, so you see **why** it scored what it did
- Odoo record id stored on our side, so a retry can never create a second copy

---

## Done when

- [ ] Leads enabled
- [ ] One sales team
- [ ] Six stages in order
- [ ] Seven lost reasons
- [ ] Integration user created
- [ ] You know your daily routine

**Then:** hand me the credentials from guide 10 and I'll build the integration.

---

## What changes when you hire

Nothing structural. When a second person joins:

- Add them as an Odoo user
- Either split the team, or keep one team and assign by priority
- Tell me, and I'll turn assignment rules back on — the backend already computes
  `enterprise_ae` vs `sdr`, it's just collapsed to one queue for now

The tier distinction is preserved in the data throughout. You are not losing it, only
not acting on it yet.
