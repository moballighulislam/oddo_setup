# 08 — Slack & calendar

**Who:** you · **Time:** 15 min · **Cost:** £0 · Optional but high value

Both are already coded. They need URLs, nothing else.

---

## Slack alerts

### What fires, and what deliberately doesn't

An alert posts **only** for demo intent — `demo_form`, or `contact_form` with
`inquiry_type: request_demo`.

Not for newsletter signups. Not for quick capture. Not for support tickets. Not for
anything flagged as a bot.

That scoping is deliberate. Alerting on every footer signup trains the team to ignore
the channel — and then the alerts that actually matter get ignored too. A demo request
from a CISO at a 1000+ company deserves a notification; a blog subscriber does not.

### What the message contains

```
New demo form — score 100 (enterprise_ae)

Name          Elena Fischer        Company       Meridian Bank
Job title     CISO                 Company size  1000+
Score         100                  Tier          enterprise_ae
SLA due       2026-09-22T12:19Z    Page          /demo
Source        google
```

Enough for an SDR to decide whether to call now, without opening the CRM.

### Setup

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name: `Deepnotch Leads` · pick your workspace
3. **Incoming Webhooks** → toggle **On**
4. **Add New Webhook to Workspace**
5. Choose the channel — a dedicated `#leads` is better than a busy general channel
6. Copy the URL (`https://hooks.slack.com/services/T.../B.../xxx`)

**Give me:**

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

> ⚠️ That URL is a credential — anyone holding it can post to your channel. Don't
> commit it or paste it publicly.

### Retry behaviour

Slack alerts get **3 attempts**, fewer than other jobs. Intentional: a late alert is
noise. By the time several retries have elapsed the moment has passed, and the lead is
in the CRM anyway.

---

## Calendar booking link

### Why it matters

The prospect can book the moment they are most interested — right after submitting —
instead of waiting for a rep to reply. That removes the scheduling back-and-forth
entirely and shortens time-to-first-meeting.

The link is attached to the **demo confirmation email**, not sent as a separate
message. Two emails within a minute reads as automation noise.

### Setup

Any scheduling tool works — it's just a URL.

| Tool | Free tier |
|---|---|
| Calendly | Yes |
| Cal.com | Yes, open source |
| HubSpot Meetings | Yes |
| Google Appointment Schedules | With Workspace |

1. Create an event type — "GRC Platform Demo", 30 or 45 minutes
2. Connect the calendar of whoever takes demos
3. Set availability and buffer time
4. Copy the public booking URL

**Give me:**

```bash
CALENDAR_BOOKING_URL=https://calendly.com/deepnotch/demo
```

### Suggested questions on the booking form

Keep it short — they already filled in your demo form. One or two at most:

- Which framework are you working toward? *(SOC 2, ISO 27001, HIPAA, other)*
- What's your target audit date?

Both feed straight into how the rep prepares.

---

## Without these

Nothing breaks. Both handlers run, log what they would have done, and record the
event as `skipped`. The audit trail stays honest — it never claims an alert was sent
when it wasn't.

---

## Done when

- [ ] Slack webhook created, pointing at a dedicated channel
- [ ] Calendar event type created with availability set
- [ ] Both URLs handed over

**Next:** [09 — Go-live checklist](./09-go-live-checklist.md)

---

## Troubleshooting

**Slack alerts not arriving**
Check the webhook URL is complete and the app is still installed in the workspace.
Test it directly:

```bash
curl -X POST -H 'content-type: application/json' \
  -d '{"text":"test"}' YOUR_WEBHOOK_URL
```

**Alerts for everything, or nothing**
Only demo intent triggers them. A newsletter signup producing no alert is correct.

**Can we alert per score instead?**
Yes, but consider the tradeoff. Layer 1 automations key on form type alone precisely
so they still fire when scoring fails. Alerting on score means a scoring outage is
also an alerting outage.
