# 02 — Email provider

**Who:** you · **Time:** 30 min · **Cost:** £0 · **Needs:** guide 01

Goal: verified sending domain and an API key, so the backend can send confirmation
emails.

---

## Why this one first

Right now a lead submits your demo form and **nobody finds out.** The job runs, logs
"would send", and records the event as skipped. Everything else is built and working.

This is the single highest-value setup step in the whole list.

---

## Which provider

**Resend.** 3,000 emails/month free, no card required, cleanest API.

| Provider | Free tier | Notes |
|---|---|---|
| **Resend** ✅ | 3,000/mo | Simplest setup, modern docs |
| Brevo | 300/day | Also does marketing campaigns — useful later for Layer 5 |
| Postmark | 100 total | Best deliverability, but paid almost immediately (~$15/mo) |
| SendGrid | 100/day | Widely used, shared-IP reputation has degraded |

At marketing-site volume you will not outgrow the free tier for a long time. A busy
month might be 500 emails.

---

## Transactional vs marketing

Two different things, and providers police the difference:

| | Transactional | Marketing |
|---|---|---|
| Example | "Thanks, we got your demo request" | 21-day nurture sequence |
| Consent | Implied — they submitted the form seconds ago | Explicit opt-in required |
| Unsubscribe | Not required | Legally required |
| Status | **This is what we're setting up** | Layer 5, later |

Some providers suspend accounts for sending marketing on a transactional stream.
We're only doing transactional today, which keeps it simple.

---

## Step 1 — Sign up (2 min)

[resend.com](https://resend.com) → **Sign Up**. Google or GitHub login, no card.

---

## Step 2 — Add the domain (1 min)

**Domains** → **Add Domain** → `deepnotch.ai`

Pick the region closest to your users.

**Use the root domain, not a subdomain.** It gives you `noreply@deepnotch.ai`, which
reads as legitimate to a compliance-focused buyer. When Layer 5 marketing starts
later, that goes on a separate subdomain so bulk sending can never damage your
transactional reputation.

---

## Step 3 — Copy the records into Cloudflare (10 min)

Resend shows three records. They look like this — **use the real values from your
dashboard, not these**:

| Type | Name | Value |
|---|---|---|
| MX | `send` | `feedback-smtp.***.amazonses.com` priority `10` |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3...` (long) |

What each does:

- **MX on `send`** — where bounces come back to, so the system can learn an address
  is dead
- **SPF** — declares which servers may send as your domain
- **DKIM** — cryptographic signature proving the message wasn't altered in transit

For each one, in Cloudflare → **DNS** → **Records** → **Add record**:

1. Select the Type
2. Paste Name exactly — `send`, not `send.deepnotch.ai`. Cloudflare appends the domain
3. Paste Content exactly. The DKIM key is long; copy all of it
4. **Proxy status: DNS only (⚪ grey).** Never orange on mail records
5. TTL: Auto
6. Save

---

## Step 4 — Verify (1–15 min)

Resend → your domain → **Verify DNS Records**.

Usually green within a couple of minutes. If not, wait and click again — that's
propagation, not a mistake.

Check what the world sees:

```bash
nslookup -type=TXT send.deepnotch.ai 8.8.8.8
nslookup -type=TXT resend._domainkey.deepnotch.ai 8.8.8.8
```

---

## Step 5 — API key (2 min)

**API Keys** → **Create API Key**

| Field | Value |
|---|---|
| Name | `dn-backend-production` |
| Permission | **Sending access** — not Full access |

Sending-only matters: if the key ever leaks, the damage is limited to sending. Full
access would let someone read your domain configuration and logs too.

**Copy it now.** Resend shows it once. It starts `re_`.

---

## Step 6 — Send a test (2 min)

Resend's dashboard has a test send. Send one to your own address and confirm:

- It arrives in the inbox, not spam
- The sender shows as `deepnotch.ai`
- No "via amazonses.com" warning in Gmail — that means DKIM isn't aligned

---

## Step 7 — Hand over

```bash
EMAIL_PROVIDER_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM_ADDRESS=noreply@deepnotch.ai
```

Send these somewhere private. Not a public channel, not a ticket comment.

---

## What I build once you do

- `sendEmail()` implemented against Resend
- HTML and plain-text templates for each of the four form types
- Unsubscribe footer with the token
- **Bounce/complaint webhook** so dead addresses mark themselves automatically
  (nothing sets those statuses today)
- Global hourly send ceiling and per-recipient frequency cap
- Tests

Then Layer 1 is live: every submission gets an acknowledgement within seconds.

---

## Done when

- [ ] Resend account created
- [ ] `deepnotch.ai` shows **Verified**
- [ ] Test email landed in the inbox, not spam
- [ ] API key created with sending-only permission
- [ ] Key and from-address handed over

**Next:** [03 — reCAPTCHA](./03-recaptcha.md)

---

## Troubleshooting

**Verification stuck on pending**
Nearly always propagation — give it 15 minutes. If it persists, check you pasted
`send` rather than `send.deepnotch.ai`; Cloudflare appends the domain, so the full
form creates `send.deepnotch.ai.deepnotch.ai`.

**Test email landed in spam**
Check DKIM verified, and that DMARC from guide 01 is present. New domains also carry
no sending history — early volume matters. Low transactional volume to people who
just filled in your form is the gentlest possible start.

**Gmail shows "via amazonses.com"**
DKIM isn't aligned. Re-check the `resend._domainkey` TXT record copied in full — it's
long and easy to truncate.

**Can I send from my existing company mailbox instead?**
No. Those servers aren't built for programmatic sending, there's no bounce webhook or
delivery log, sending limits are low, and automated volume damages the reputation of
your staff's real email.
