# 03 — reCAPTCHA v3

**Who:** you · **Time:** 10 min · **Cost:** £0 · **Needs:** guide 01

Goal: site key and secret key so bot filtering works in production.

---

## Why it's not optional

Your form endpoint is public. Anyone can POST to it, forever, for free. Without
reCAPTCHA you have two defences left: a honeypot field and a submit-speed check. Both
are trivially bypassed by anything more sophisticated than a basic script.

The code is already written and waiting for keys. `env.ts` **refuses to start in
production** without `RECAPTCHA_SECRET_KEY` — you cannot accidentally ship without it.

---

## How v3 differs from the checkbox

reCAPTCHA v3 shows **no challenge**. No "select all traffic lights", no checkbox. It
scores each request 0.0–1.0 based on behaviour and returns that score to the server.

That matters for a GRC product: an enterprise buyer hitting an image puzzle on your
demo form is friction on your highest-value conversion.

| Score | Meaning |
|---|---|
| 1.0 | Almost certainly human |
| 0.5 | **Default threshold** |
| 0.0 | Almost certainly a bot |

**How this backend uses it:** a low score does **not** reject the submission. The row
is stored with `is_suspected_bot = 1` and generates no automation jobs. A false
positive that silently discards a real enterprise lead costs far more than a spam row
costs to filter later.

---

## Step 1 — Create the site (5 min)

Go to [google.com/recaptcha/admin/create](https://www.google.com/recaptcha/admin/create)

Sign in with a Google account — ideally a **shared company account**, not personal.
Whoever owns it holds the keys.

| Field | Value |
|---|---|
| Label | `deepnotch.ai` |
| Type | **reCAPTCHA v3** ⚠️ not v2 |
| Domains | `deepnotch.ai` |
| | `www.deepnotch.ai` |
| | `localhost` (for development) |
| Owners | Add a second colleague |

Accept the terms, **Submit**.

> Do **not** add `api.deepnotch.ai`. reCAPTCHA runs in the browser on pages that host
> a form. The API only verifies the resulting token server-side.

---

## Step 2 — Two keys, two places

| Key | Goes to | Public? |
|---|---|---|
| **Site key** | Frontend, in the page | Yes — visible in page source by design |
| **Secret key** | Backend `.env` | **No — never in frontend code** |

If the secret key ends up in frontend source, anyone can forge valid verifications and
your bot filtering is worthless. Rotate it immediately if that happens.

---

## Step 3 — Hand over

To me:

```bash
RECAPTCHA_SECRET_KEY=6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

To whoever builds the frontend forms:

```
Site key: 6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Step 4 — What the frontend does with it

For the frontend developer. Each form page loads the script and attaches a token:

```html
<script src="https://www.google.com/recaptcha/api.js?render=YOUR_SITE_KEY"></script>
```

```js
grecaptcha.ready(() => {
  grecaptcha
    .execute('YOUR_SITE_KEY', { action: 'submit_form' })
    .then((token) => {
      // include as recaptcha_token in the POST body
    });
});
```

The token is single-use and expires after two minutes, so generate it **at submit
time**, not on page load.

Full payload contract: `docs/api-examples.md`.

---

## Step 5 — Tuning the threshold (later)

Default is `0.5`, set by `RECAPTCHA_SCORE_THRESHOLD`.

After a couple of weeks, check the real distribution:

```sql
SELECT ROUND(recaptcha_score, 1) AS score, COUNT(*)
FROM form_submissions
GROUP BY 1 ORDER BY 1;
```

If genuine leads are clustering below 0.5, lower it. Because flagged submissions are
stored rather than dropped, mistuning is recoverable — you can always look at what got
flagged and reprocess it.

---

## Done when

- [ ] reCAPTCHA **v3** site created for `deepnotch.ai`
- [ ] `www.deepnotch.ai` and `localhost` included
- [ ] A colleague added as owner
- [ ] Secret key sent to me
- [ ] Site key sent to the frontend developer

**Next:** [04 — Database](./04-database.md)

---

## Troubleshooting

**"Invalid domain for site key"**
The domain in the browser must match one registered. `www.deepnotch.ai` and
`deepnotch.ai` are different entries — register both.

**Everything scores 0.9, including obvious bots**
Normal early on. v3 learns from traffic patterns and needs real volume.

**Everything scores below 0.3**
Usually the token is being generated once on page load and reused. Generate it per
submit.

**Lost the secret key**
The admin console can regenerate it. Regenerating invalidates the old one, so update
`.env` in the same pass.
