# 11 — CRM process design (pre-launch)

**Who:** you · **Time:** 20 min · **Cost:** £0 · **Needs:** guide 10

Read this **before** configuring Odoo.

> **Note:** an earlier version of this guide specified six pipeline stages and seven
> lost reasons. That was over-built for a site with no traffic. This version is
> deliberately smaller.

---

## Where you actually are

- Website launching, not launched
- No paid traffic
- New domain, so effectively no organic authority — ranking takes months
- Zero customers

**Realistic first-quarter volume: 0–5 form submissions a month**, most of them
curiosity or spam.

That number should drive everything below. A pipeline built for 200 leads a month,
run at 3 leads a month, becomes an abandoned chore within weeks — and an abandoned
pipeline is worse than none, because it makes your data lie.

---

## The test

**Before adding any stage, field or automation: will it change a decision someone
makes in the next 30 days?**

If not, don't build it. Odoo makes everything below easy to add later; none of it is
easier to add now.

Applying that test honestly:

| Thing | Changes a decision? | Verdict |
|---|---|---|
| Knowing a lead arrived | Yes — you call them | ✅ Already done via Slack + email |
| **Which page brought them** | **Yes — tells you what to write next** | ✅ **The main event** |
| What you said last time | Yes, on the second call | ✅ Notes |
| 6 pipeline stages | No — you'll have 3 leads and remember all of them | ❌ Cut to 4 |
| 7 lost reasons | No — you'll lose maybe 2 deals | ❌ Cut to 4 |
| Assignment rules | No — there's one of you | ❌ Skip |
| Email templates in Odoo | No | ❌ Skip |
| Sales targets, forecasting | No — nothing to forecast | ❌ Skip |

---

## What the CRM is for right now

**Not pipeline management. Attribution.**

With no PPC, every lead comes from something you wrote or somewhere you appeared. The
question worth answering is *which*.

Your backend already captures this on every submission:

| Field | Answers |
|---|---|
| `landing_page` | Which page or blog post they arrived on |
| `referrer_url` | Which site sent them |
| `utm_*` | Which campaign, once you run any |
| `framework_interest` | Which compliance framework they care about |

**That is your content strategy, derived from real behaviour rather than guesswork.**
Three leads from one SOC 2 article tells you more than any keyword tool.

Lead source is also the field most commonly neglected early and the most expensive to
retrofit. Capturing it consistently from day one means that by the time you're making
real budget decisions, you have a year of clean history.

---

## Minimal Odoo configuration

### 1. Enable Leads ⚠️

**Settings → CRM → Leads** ✅ (off by default)

This is what keeps newsletter subscribers out of your pipeline.

| Tier | Odoo | Why |
|---|---|---|
| 80–100, 50–79 | **Opportunity** — pipeline | Someone will contact them |
| 30–49, 0–29 | **Lead** — outside pipeline | A list, not a deal |
| support / partnership / media | **Not pushed** | Not deals |

Keep this even at low volume. It's not about absolute numbers but ratio — a blog post
that brings 200 visitors might produce 10 newsletter signups and 1 demo request. If
all 11 land in the pipeline, the one that matters is buried.

Costs you nothing: the backend decides it automatically.

### 2. Four stages

```
New → Contacted → Meeting → Proposal → Won / Lost
```

| Stage | Enter when |
|---|---|
| **New** | Integration created it |
| **Contacted** | You've emailed or called |
| **Meeting** | A call is booked |
| **Proposal** | Pricing sent |

Four working stages is the low end of the usual 3–5 recommendation, which is right for
pre-revenue. Add stages when you hit something you genuinely can't track — a security
review, a legal redline — not in advance.

**The rule:** a stage advances on **their** action, not your optimism. "I sent a good
email" is still Contacted.

### 3. Four lost reasons

**CRM → Configuration → Lost Reasons**

| Reason | What it tells you |
|---|---|
| **No response** | Your outreach, not their interest |
| **Bad timing — no audit due** | Future pipeline. Set a reminder, don't delete |
| **Not a fit** | Targeting problem |
| **Chose a competitor** | **Ask which.** The most valuable thing you'll learn early |

Four, not seven. You can add "No budget" and "Already has a tool" when you've actually
lost deals for those reasons and can tell them apart.

### 4. One sales team

`Inbound`. You are the only member. Skip assignment rules entirely.

### 5. Skip everything else

Not now: email templates, automated actions, scoring rules, multiple teams, sales
targets, custom fields, recurring revenue tracking.

Odoo supports all of it. None of it changes a decision in your next 30 days.

---

## Your actual routine

**When a lead arrives** — you already get a Slack alert and the confirmation email is
sent automatically. Open Odoo, read the score breakdown in the description, call or
email them. Log what happened as a note.

**Weekly, 10 minutes** — look at the Leads list. Anyone re-engaged? Move dead
opportunities to Lost with a reason.

**Monthly, 20 minutes — the one that matters:**

```
CRM → Reporting → group by Source / Campaign
```

Which pages produced leads? That tells you what to write next month. At this stage
that single report is worth more than the entire pipeline.

---

## When to add more

Add complexity when you hit the trigger, not before:

| Trigger | Add |
|---|---|
| Over 20 leads/month | More stages, if you're genuinely losing track |
| Second person selling | Assignment rules, team split — the backend already computes the tier |
| Running PPC | Campaign-level reporting, cost-per-lead |
| Over 10 deals lost | More granular lost reasons |
| Repeating the same email | Templates |
| Missing follow-ups | Automated activity reminders |

Every one of these is a config change. The backend data model already supports all of
it — the tier, score and full attribution are stored regardless of whether Odoo acts
on them today.

---

## Odoo configuration checklist

- [ ] **Settings → CRM → enable Leads**
- [ ] **Configuration → Sales Teams** — one team, `Inbound`
- [ ] **Configuration → Stages** — New, Contacted, Meeting, Proposal, Won, Lost
- [ ] **Configuration → Lost Reasons** — the four above
- [ ] **Settings → Users** — create `Backend Integration` (guide 10)
- [ ] Confirm you're the default salesperson on `Inbound`

**20 minutes.** If it takes longer, something is being over-configured.

---

## Is Odoo even worth it yet?

Reasonable question. Common advice is that a spreadsheet is enough for your first ~20
deals, because it forces you to understand the motion before automating it.

That advice assumes manual data entry. Yours is automatic — the backend pushes leads
with full attribution, scoring and history whether or not you look at them. The
marginal cost is near zero, and you avoid migrating a year of records later.

**So: set it up, minimally, and mostly ignore it until leads start arriving.** The
attribution report is the part to actually open.

---

## What I build once configured

- Opportunity for the two sales tiers, Lead for the rest, nothing for non-sales
- Dedupe by email — update, never duplicate
- Priority stars from score
- Framework, tier and source tags
- Native UTM mapping (`source_id`, `medium_id`, `campaign_id`) so attribution reporting
  works out of the box
- Score breakdown in the description, so you see *why* it scored what it did
- Odoo id stored on our side, so a retry can't create a second copy

Deliberately **not** building yet: activity/SLA creation. With 3 leads a month you are
not going to miss one. It's a few lines when volume justifies it.

---

## Done when

- [ ] Leads enabled
- [ ] Four stages, four lost reasons, one team
- [ ] Integration user created
- [ ] You know the monthly attribution report is the thing to open

**Then:** send me the credentials from guide 10.
