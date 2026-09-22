# 06 — Frontend hosting

**Who:** you · **Time:** 30 min · **Cost:** £0 · **Needs:** guide 01

Goal: the marketing site live at `deepnotch.ai` and `www.deepnotch.ai`.

---

## Options

| Option | Cost | Notes |
|---|---|---|
| **Vercel** ✅ | Free | Built by the Next.js team. Preview deploy per branch, global CDN |
| Netlify | Free | Equivalent for most purposes |
| Cloudflare Pages | Free | DNS already there, so one less account |
| Railway | ~$5/mo | Same place as the backend, but no CDN edge caching |

**Recommendation: Vercel** if the frontend is Next.js. Its free tier is genuinely
sufficient for a marketing site, and per-branch preview URLs make review easy.

Unlike the backend, the frontend has no long-running process — it's static files plus
some server rendering, which is exactly what these platforms are built for.

---

## Step 1 — Repo (5 min)

Push the frontend to its own private repo, or a shared monorepo with the backend.

If it's a monorepo, note the frontend's subdirectory — Vercel needs it.

---

## Step 2 — Import (5 min)

1. [vercel.com](https://vercel.com) → sign in with GitHub
2. **Add New** → **Project** → select the repo
3. Framework preset: Vercel usually detects Next.js
4. Root directory: set it if the frontend is in a subfolder
5. **Deploy**

You get a `*.vercel.app` URL. Confirm the site loads before touching DNS.

---

## Step 3 — Environment variables (5 min)

Vercel → **Settings** → **Environment Variables**:

```bash
NEXT_PUBLIC_API_URL=https://api.deepnotch.ai
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=6Lxxxxxxxx    # SITE key, from guide 03
```

⚠️ **`NEXT_PUBLIC_` variables are visible in the browser.** That's fine for these two —
the API URL is public anyway and the reCAPTCHA site key is designed to be public.

**Never** put the reCAPTCHA *secret* key here, or the email API key, or the database
URL. Those belong only on the backend. Anything with `NEXT_PUBLIC_` is shipped to
every visitor.

---

## Step 4 — Custom domain (10 min)

Vercel → **Settings** → **Domains** → add both:

- `deepnotch.ai`
- `www.deepnotch.ai`

Vercel shows DNS records. In Cloudflare:

| Name | Type | Value | Proxy |
|---|---|---|---|
| `@` | A | `76.76.21.21` *(use Vercel's actual value)* | 🟠 Proxied |
| `www` | CNAME | `cname.vercel-dns.com` *(use Vercel's actual value)* | 🟠 Proxied |

If an A record already exists for `@` from the current placeholder page, **edit it**
rather than adding a second — two A records for the same name split traffic
unpredictably.

Pick one as canonical (usually the apex, `deepnotch.ai`) and let Vercel redirect the
other. Two URLs serving identical content splits your SEO and complicates the CORS
configuration in guide 07.

---

## Step 5 — Verify

- [ ] `https://deepnotch.ai` loads
- [ ] `https://www.deepnotch.ai` loads or redirects
- [ ] Padlock shows, no certificate warning
- [ ] `http://` redirects to `https://`

---

## Step 6 — What the frontend needs to do

For whoever builds the forms. Full contract in `docs/api-examples.md`; the Postman
collection has every request.

**Four forms**, posting to:

```
POST https://api.deepnotch.ai/api/forms/{formId}/submit
```

| Form | `formId` |
|---|---|
| Popup / banner | `quick_capture` |
| Newsletter | `footer_form` |
| Book a demo | `demo_form` |
| Contact | `contact_form` |

**Every submission must include:**

| Field | Why |
|---|---|
| `submission_uuid` | A fresh v4 UUID per submission — the idempotency key. Prevents a double-click creating two leads |
| `form_name` | Where the form sits, e.g. `homepage_popup`. Reporting only |
| `website` | The honeypot — a hidden input, left empty. Hide with CSS, **never** `type="hidden"`, which bots detect |
| `form_render_ms` | Milliseconds between render and submit. Under 3s is treated as a bot |
| `recaptcha_token` | Generated at submit time, not page load — tokens expire in two minutes |

**Plus the tracking snippet**, which should persist UTM parameters in a 90-day
first-party cookie, keep `first_touch_src` write-once, and count pages viewed per
session. I'll supply this in guide 07.

**Handling the response:**

| Status | Do |
|---|---|
| 200 | Show success |
| 400 `validation_failed` | Render `fields` next to the matching inputs |
| 400 `personal_email` | "Please use your work email address" |
| 429 | "Too many submissions, please try again later" |
| 500 | Generic error, invite a retry |

The response deliberately contains no score or routing information — that's internal
sales intelligence, not something the browser needs.

---

## Done when

- [ ] Site live on `deepnotch.ai` with a valid certificate
- [ ] `www` redirects to the canonical domain
- [ ] `NEXT_PUBLIC_API_URL` points at `api.deepnotch.ai`
- [ ] Site key set, secret key **not** present anywhere in frontend config

**Next:** [07 — Connecting them](./07-connect-frontend-backend.md)

---

## Troubleshooting

**"Invalid configuration" on the domain in Vercel**
Cloudflare proxy can confuse Vercel's verification. Set the record to DNS-only (grey)
until it verifies, then switch the proxy back on.

**Site loads but forms fail with a CORS error**
Expected until guide 07. The backend must be told which origins to trust.

**Two A records for `@`**
Delete the old placeholder one. Two records for the same name round-robin traffic and
half your visitors hit the wrong server.
