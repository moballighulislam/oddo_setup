# 07 — Connecting frontend and backend

**Who:** me (config) + frontend developer (snippet) · **Time:** 30 min · **Cost:** £0
**Needs:** guides 05, 06

Goal: forms on `deepnotch.ai` successfully submitting to `api.deepnotch.ai`.

---

## The one thing that breaks here

CORS. A browser will not let `deepnotch.ai` POST to `api.deepnotch.ai` unless the API
explicitly says that origin is allowed.

`CORS_ORIGINS` must match **exactly** — protocol, subdomain, no trailing slash:

| Value | Works? |
|---|---|
| `https://deepnotch.ai` | ✅ |
| `http://deepnotch.ai` | ❌ wrong protocol |
| `deepnotch.ai` | ❌ no protocol |
| `https://deepnotch.ai/` | ❌ trailing slash |
| `https://www.deepnotch.ai` | ✅ but only for `www` |

Both apex and `www` need listing if both serve the site:

```bash
CORS_ORIGINS=https://deepnotch.ai,https://www.deepnotch.ai
```

**Production refuses to start with `*`.** Deliberate: a wildcard on a public form
endpoint lets any site on the internet post to it from a visitor's browser.

---

## Step 1 — Backend variables · me

```bash
CORS_ORIGINS=https://deepnotch.ai,https://www.deepnotch.ai
PUBLIC_APP_URL=https://deepnotch.ai      # where unsubscribe redirects land
PUBLIC_API_URL=https://api.deepnotch.ai  # used to build unsubscribe links in emails
```

---

## Step 2 — The tracking snippet · frontend developer

Add once, sitewide — in `_app.tsx`, the root layout, or a `<Script>` tag.

This captures the hidden fields the backend expects. All of it is optional server-side
— a missing UTM must never cost a lead — but attribution and behavioural scoring are
blind without it.

```html
<script>
(function () {
  var COOKIE_DAYS = 90;

  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 864e5);
    document.cookie =
      name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  function getCookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : '';
  }

  var params = new URLSearchParams(location.search);

  // --- UTM, persisted 90 days for multi-touch attribution ---
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
    .forEach(function (k) {
      var v = params.get(k);
      if (v) setCookie(k, v, COOKIE_DAYS);
    });

  // --- Paid click ids ---
  // Without these you cannot import offline conversions back into the ad platforms,
  // so they never learn which click became a deal and cannot optimise bidding.
  // Impossible to backfill, so capture them before any ads run.
  ['gclid', 'fbclid', 'msclkid', 'li_fat_id'].forEach(function (k) {
    var v = params.get(k);
    if (v) setCookie(k, v, COOKIE_DAYS);
  });

  // First touch is WRITE-ONCE: the campaign that originally found them.
  if (!getCookie('first_touch_src')) {
    setCookie('first_touch_src', params.get('utm_source') || 'direct', COOKIE_DAYS);
  }
  setCookie('last_touch_src',
    params.get('utm_source') || getCookie('last_touch_src') || 'direct', COOKIE_DAYS);

  // Landing page is write-once too - it drives nurture branching by content topic.
  if (!getCookie('landing_page')) setCookie('landing_page', location.pathname, COOKIE_DAYS);

  // First ever visit, for measuring how long they have been evaluating.
  if (!getCookie('dn_first_seen')) setCookie('dn_first_seen', String(Date.now()), 365);

  // --- Session ---
  if (!sessionStorage.getItem('dn_session')) {
    sessionStorage.setItem('dn_session',
      'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    sessionStorage.setItem('dn_started', String(Date.now()));
  }

  var pages = parseInt(sessionStorage.getItem('dn_pages') || '0', 10) + 1;
  sessionStorage.setItem('dn_pages', String(pages));

  // The route through the site, not just the count. This is what shows which
  // content actually produces leads.
  var journey = [];
  try { journey = JSON.parse(sessionStorage.getItem('dn_journey') || '[]'); } catch (e) {}
  journey.push(location.pathname);
  if (journey.length > 50) journey = journey.slice(-50);
  sessionStorage.setItem('dn_journey', JSON.stringify(journey));

  var visits = parseInt(getCookie('dn_visits') || '0', 10);
  if (!sessionStorage.getItem('dn_counted')) {
    setCookie('dn_visits', String(visits + 1), COOKIE_DAYS);
    sessionStorage.setItem('dn_counted', '1');
  }

  if (location.pathname.indexOf('/pricing') === 0) setCookie('dn_pricing', '1', COOKIE_DAYS);

  // --- Scroll depth on this page ---
  var maxScroll = 0;
  window.addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return;
    var pct = Math.round((window.scrollY / h) * 100);
    if (pct > maxScroll) maxScroll = Math.min(100, pct);
  }, { passive: true });

  // --- Collect everything for a submission ---
  window.dnTracking = function () {
    var firstSeen = parseInt(getCookie('dn_first_seen') || String(Date.now()), 10);
    var started = parseInt(sessionStorage.getItem('dn_started') || String(Date.now()), 10);

    return {
      utm_source: getCookie('utm_source') || undefined,
      utm_medium: getCookie('utm_medium') || undefined,
      utm_campaign: getCookie('utm_campaign') || undefined,
      utm_term: getCookie('utm_term') || undefined,
      utm_content: getCookie('utm_content') || undefined,

      gclid: getCookie('gclid') || undefined,
      fbclid: getCookie('fbclid') || undefined,
      msclkid: getCookie('msclkid') || undefined,
      li_fat_id: getCookie('li_fat_id') || undefined,

      first_touch_src: getCookie('first_touch_src') || undefined,
      last_touch_src: getCookie('last_touch_src') || undefined,

      // Full URL including the query string. location.pathname alone drops
      // ?ref=, ?variant= and anything else a campaign appended.
      page_url: location.pathname + location.search,
      referrer_url: document.referrer || undefined,
      landing_page: getCookie('landing_page') || undefined,

      session_id: sessionStorage.getItem('dn_session'),
      pages_viewed: parseInt(sessionStorage.getItem('dn_pages') || '1', 10),
      page_journey: journey,
      visit_count: parseInt(getCookie('dn_visits') || '1', 10),
      time_on_site_sec: Math.round((Date.now() - started) / 1000),
      days_since_first_visit: Math.floor((Date.now() - firstSeen) / 864e5),
      visited_pricing: getCookie('dn_pricing') === '1',
      scroll_depth: maxScroll,

      device_type: /iPad|Tablet/i.test(navigator.userAgent)
        ? 'tablet'
        : /Mobi|Android|iPhone/i.test(navigator.userAgent)
        ? 'mobile'
        : 'desktop',
      browser_language: navigator.language || undefined,
      browser_timezone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || undefined,
    };
  };
})();
</script>
```

---

## Step 3 — Submitting a form · frontend developer

```js
// Record when the form became visible. Anything under 3 seconds is treated as a bot.
const renderedAt = Date.now();

async function submitForm(formId, formName, fields) {
  const token = await grecaptcha.execute(SITE_KEY, { action: 'submit_form' });

  const res = await fetch(`${API_URL}/api/forms/${formId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // Fresh per submission. A retry with the same uuid replays the original
      // response instead of creating a second lead.
      submission_uuid: crypto.randomUUID(),
      form_name: formName,

      ...fields,
      ...window.dnTracking(),

      form_render_ms: Date.now() - renderedAt,
      website: fields.website || '',   // honeypot — must stay empty
      recaptcha_token: token,
    }),
  });

  const body = await res.json();

  if (res.ok) return { ok: true };
  if (body.error === 'validation_failed') return { ok: false, fields: body.fields };
  return { ok: false, message: body.message };
}
```

### The honeypot

```html
<div aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden">
  <label>Website</label>
  <input type="text" name="website" tabindex="-1" autocomplete="off" />
</div>
```

Hide it with **CSS positioning, not `type="hidden"`**. Bots skip hidden inputs but
fill visible ones they find in the DOM. `tabindex="-1"` and `aria-hidden` keep it away
from keyboard and screen-reader users.

---

## Step 4 — Consent checkbox

Required for GDPR. The backend stores `consent_given`, `consent_ip`,
`consent_text_version` and `consent_at`.

```html
<label>
  <input type="checkbox" name="consent_given" />
  I agree to receive communications from Deepnotch. See our
  <a href="/privacy">privacy policy</a>.
</label>
```

Send `consent_text_version` (e.g. `"v1"`) alongside. When the wording changes, bump
it — "they consented" is only defensible if you can show *what* they agreed to.

> The footer/newsletter form subscribes on submit. Every other form only subscribes
> when consent is explicitly ticked — a demo request is not permission to market.

---

## Step 5 — Verify end to end

1. Open `https://deepnotch.ai`, submit a real demo form
2. Browser console: no CORS errors, response is `{ ok: true, submission_id: "..." }`
3. Database: lead, submission and tracking rows all present and linked
4. `https://api.deepnotch.ai/health`: `succeeded` count went up
5. Inbox: confirmation email arrived
6. Slack: alert fired, if configured

---

## Done when

- [ ] `CORS_ORIGINS` set to the exact production origins
- [ ] Tracking snippet live sitewide
- [ ] All four forms posting with uuid, honeypot, timing and token
- [ ] Consent checkbox present
- [ ] Field-level errors rendering next to inputs
- [ ] A real submission verified through to the database and inbox

**Next:** [08 — Slack & calendar](./08-slack-and-calendar.md) or straight to
[09 — Go-live](./09-go-live-checklist.md)

---

## Troubleshooting

**"blocked by CORS policy"**
The origin in the error must appear verbatim in `CORS_ORIGINS`. Check protocol and
`www`, and restart the backend after changing it.

**Everything flagged as a bot**
`form_render_ms` is being sent as 0 or missing. Capture `renderedAt` when the form
renders, not when it submits.

**`recaptcha_token` rejected**
Tokens expire after two minutes and are single-use. Generate per submit.

**UTMs always empty**
Cookies are per-origin. Testing on `localhost` against production won't share them.

**"Do we need a cookie banner?"**
These are first-party cookies for attribution, which in most EU readings require
consent. Worth asking whoever handles your privacy policy. The backend works fine
without them — it just loses attribution data.
