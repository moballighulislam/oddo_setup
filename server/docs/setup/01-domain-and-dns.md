# 01 — Domain & DNS

**Who:** you · **Time:** 30 min · **Cost:** £0 · ⛔ **Blocks everything else**

Goal: `deepnotch.ai` on Cloudflare DNS, ready to point at your services.

---

## Current state

Checked on 2026-09-22:

| Thing | Status |
|---|---|
| Domain | ✅ `deepnotch.ai` owned |
| Nameservers | ✅ Already on Cloudflare (`anuj.ns.cloudflare.com`, `luciana.ns.cloudflare.com`) |
| A record | ✅ Live, proxied through Cloudflare |
| MX (mail) | ⬜ None — nothing to break |
| SPF | ⬜ None — clean slate |
| DMARC | 🟡 Record exists but is empty |

**You are already most of the way there.** DNS is on Cloudflare and there are no
existing mail records to conflict with.

---

## Why Cloudflare matters here

Not just preference — this backend already depends on two Cloudflare headers:

| Header | What the code does with it |
|---|---|
| `cf-connecting-ip` | The real visitor IP, for consent records and geolocation. Without it every visitor appears to come from the load balancer and rate limiting stops working |
| `cf-ipcountry` | The visitor's country. This is what lets a German phone number like `030 12345678` normalise to `+493012345678` instead of being misread as a US number |

That code is written and tested. It starts working the moment traffic flows through
Cloudflare.

---

## Step 1 — Confirm access

1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com)
2. You should see `deepnotch.ai` listed
3. Click it → **DNS** → **Records**

If you can see and edit records here, you're done with the hard part.

---

## Step 2 — Understand what you'll add later

Nothing to add yet. Later guides will have you create these:

| Guide | Records |
|---|---|
| 02 Email | 1 MX + 2 TXT (SPF, DKIM) — proves you own the domain when sending |
| 05 Backend | `api` → your backend host |
| 06 Frontend | `@` and `www` → Vercel |

Final picture:

| Name | Type | Points to | Proxy |
|---|---|---|---|
| `@` | A / CNAME | Vercel | 🟠 On |
| `www` | CNAME | Vercel | 🟠 On |
| `api` | CNAME | Railway | 🟠 On |
| `send` | MX + TXT | Resend | ⚪ Off |
| `resend._domainkey` | TXT | Resend | ⚪ Off |
| `_dmarc` | TXT | policy | ⚪ Off |

---

## Step 3 — The proxy toggle (read this before guide 02)

Cloudflare shows an **orange cloud** next to records it can proxy.

| State | Meaning | Use for |
|---|---|---|
| 🟠 **Proxied** | Traffic goes through Cloudflare — DDoS protection, caching, and the `cf-*` headers this backend needs | Website and API records |
| ⚪ **DNS only** | Cloudflare just answers the lookup | **All email records** |

**Proxying an email record breaks mail authentication.** This is the single most
common mistake when setting up sending on Cloudflare.

MX and TXT records don't offer the toggle at all, so it only bites on CNAMEs — but
check anyway.

---

## Step 4 — Add DMARC (5 min)

Your `_dmarc` record exists but is empty. Fill it in before sending starts — it
improves inbox placement and costs nothing.

**DNS → Records → Add record**

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:dmarc@deepnotch.ai` |
| TTL | Auto |

`p=none` means **monitor only** — nothing gets rejected, you just start collecting
reports. Safe to add today.

Once sending has been stable for a few weeks you can tighten it to `p=quarantine`,
then `p=reject`. Don't start there: a misconfiguration at `p=reject` silently bins
your own confirmation emails.

---

## Step 5 — Check SSL mode

**SSL/TLS → Overview**

Set to **Full (strict)**.

| Mode | Why not |
|---|---|
| Off | No encryption |
| Flexible | Cloudflare→your server is unencrypted. Form submissions carry names, emails and phone numbers — that leg must be encrypted too |
| Full | Encrypted but certificates aren't validated |
| **Full (strict)** | ✅ Encrypted and validated |

Both Vercel and Railway issue valid certificates, so Full (strict) works without extra
setup.

---

## Done when

- [ ] You can edit DNS records for `deepnotch.ai` in Cloudflare
- [ ] DMARC TXT record added with `p=none`
- [ ] SSL/TLS set to Full (strict)
- [ ] You understand the orange-cloud rule for email records

**Next:** [02 — Email provider](./02-email-provider.md). Start it now even if you're
not ready to deploy — DNS verification is the step most likely to stall.

---

## Troubleshooting

**"I don't see deepnotch.ai in Cloudflare"**
Someone else on the team owns the account. Ask to be added as a member, or get the
records added on your behalf.

**"Changes aren't taking effect"**
DNS caches. Wait 5–15 minutes. Check what the world actually sees:

```bash
nslookup -type=TXT deepnotch.ai 8.8.8.8
```

That queries Google's resolver rather than your local cache.

**"Do I need to change registrar?"**
No. Cloudflare handles DNS while your registrar keeps ownership. Nothing to move.
