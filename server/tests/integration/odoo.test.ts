/**
 * Odoo client tests.
 *
 * Runs against a stub HTTP server that speaks Odoo's JSON-RPC protocol, so the client
 * is verified end to end — request shape, error handling, dedup logic — without
 * needing a real instance.
 *
 * The stub matters most for the failure cases. Odoo returns application errors inside
 * an HTTP 200 response, which is exactly the kind of thing that silently passes in
 * production if nothing tests it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';

let server: Server;
let port: number;

/** Every execute_kw call the client made, for asserting on. */
interface Call {
  service: string;
  method: string;
  model?: string;
  modelMethod?: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
}
let calls: Call[] = [];

/** Test-controlled responses, keyed by "model.method". */
let responses: Record<string, unknown> = {};
/** When set, the next call returns an Odoo-style error. */
let failNext: string | null = null;
/** When true, login returns false — Odoo's way of rejecting credentials. */
let rejectLogin = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body) as {
        params: { service: string; method: string; args: unknown[] };
      };
      const { service, method, args } = parsed.params;

      const reply = (payload: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (service === 'common' && method === 'login') {
        calls.push({ service, method });
        // Odoo returns `false` for bad credentials rather than raising.
        return reply({ result: rejectLogin ? false : 7 });
      }

      if (service === 'common' && method === 'version') {
        return reply({ result: { server_version: '18.0' } });
      }

      const [, , , model, modelMethod, callArgs, kwargs] = args as [
        string, number, string, string, string, unknown[], Record<string, unknown>,
      ];
      const key = `${model}.${modelMethod}`;
      calls.push({ service, method, model, modelMethod, args: callArgs, kwargs });

      if (failNext === key) {
        failNext = null;
        // Odoo reports errors in a 200 response body.
        return reply({
          error: { data: { name: 'odoo.exceptions.AccessError', message: 'Access Denied' } },
        });
      }

      return reply({ result: responses[key] ?? (modelMethod === 'search' ? [] : 1) });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;

  process.env.ODOO_URL = `http://127.0.0.1:${port}`;
  process.env.ODOO_DB = 'testdb';
  process.env.ODOO_USERNAME = 'integration@deepnotch.ai';
  process.env.ODOO_API_KEY = 'test-key';
  process.env.ODOO_SALES_TEAM = 'Inbound';
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  calls = [];
  responses = {};
  failNext = null;
  rejectLogin = false;
  const { resetOdooCache } = await import('../../src/services/odoo.js');
  resetOdooCache();
});

const baseLead = {
  email: 'elena@meridian-bank.com',
  firstName: 'Elena',
  lastName: 'Fischer',
  phone: '+493012345678',
  companyName: 'Meridian Bank',
  jobTitle: 'CISO',
  companySize: '1000+',
  countryCode: 'DE',
  leadScore: 100,
  routingTier: 'enterprise_ae',
  frameworkInterest: 'soc2,iso27001',
  scoreBreakdown: ['+30 — Submitted demo form', '+25 — Company size: 1000+'],
  formId: 'demo_form',
  formName: 'book_a_demo',
  message: 'Audit deadline next month.',
  landingPage: '/frameworks/soc2-checklist',
  pageUrl: '/demo',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'grc_q4',
  referrerUrl: 'https://www.google.com/',
  firstTouchSource: 'linkedin',
  adClickIds: { gclid: 'Cj0KCQtest123' },
  pageJourney: ['/blog/soc2-guide', '/platform', '/pricing', '/demo'],
  pagesViewed: 8,
  visitCount: 3,
  timeOnSiteSec: 840,
  daysSinceFirstVisit: 47,
  visitedPricing: true,
  scrollDepth: 92,
  deviceType: 'desktop',
  browserLanguage: 'de-DE',
  browserTimezone: 'Europe/Berlin',
  ipAddress: '88.99.100.50',
  geoCity: 'Berlin',
  geoRegion: 'Berlin',
  geoIsp: 'Deutsche Telekom AG',
  geoIsHosting: false,
  existingOdooId: null,
};

/** The values dict from the crm.lead.create call. */
function createdValues(): Record<string, unknown> {
  const call = calls.find((c) => c.model === 'crm.lead' && c.modelMethod === 'create');
  return (call?.args?.[0] ?? {}) as Record<string, unknown>;
}

describe('connection', () => {
  it('authenticates and reports the server version', async () => {
    const { testConnection } = await import('../../src/services/odoo.js');
    const result = await testConnection();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('18.0');
  });

  it('gives an actionable error when credentials are rejected', async () => {
    // Odoo answers a bad login with `false` rather than raising, so an unchecked
    // client would carry on and fail confusingly at the first real call.
    rejectLogin = true;

    const { testConnection } = await import('../../src/services/odoo.js');
    const result = await testConnection();

    expect(result.ok).toBe(false);
    // The database name is the usual culprit, so the message must name it.
    expect(result.detail).toContain('database name');
  });

  it('does not cache a failed login', async () => {
    const { resetOdooCache, testConnection } = await import('../../src/services/odoo.js');

    rejectLogin = true;
    expect((await testConnection()).ok).toBe(false);

    rejectLogin = false;
    resetOdooCache();
    expect((await testConnection()).ok).toBe(true);
  });

  it('surfaces an Odoo error returned inside a 200 response', async () => {
    // The failure mode that passes silently if untested.
    failNext = 'crm.lead.search';
    const { pushLead } = await import('../../src/services/odoo.js');

    await expect(pushLead({ ...baseLead })).rejects.toThrow(/Access Denied/);
  });
});

describe('lead type', () => {
  it('creates an Opportunity for sales tiers', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');

    for (const tier of ['enterprise_ae', 'sdr']) {
      calls = [];
      const result = await pushLead({ ...baseLead, routingTier: tier });
      expect(result.type).toBe('opportunity');
      expect(createdValues().type).toBe('opportunity');
    }
  });

  it('creates a Lead for nurture tiers, keeping them out of the pipeline', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');

    for (const tier of ['nurture', 'marketing_drip']) {
      calls = [];
      const result = await pushLead({ ...baseLead, routingTier: tier, leadScore: 20 });
      expect(result.type).toBe('lead');
      expect(createdValues().type).toBe('lead');
    }
  });
});

describe('field mapping', () => {
  it('maps contact details onto the right Odoo fields', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });

    const v = createdValues();
    expect(v.contact_name).toBe('Elena Fischer');
    expect(v.email_from).toBe('elena@meridian-bank.com');
    expect(v.phone).toBe('+493012345678');
    expect(v.partner_name).toBe('Meridian Bank'); // company, not contact
    expect(v.function).toBe('CISO'); // job title
  });

  it('maps score to priority stars', async () => {
    const { pushLead, resetOdooCache } = await import('../../src/services/odoo.js');

    const cases: Array<[number, string]> = [
      [100, '3'],
      [80, '3'],
      [79, '2'],
      [50, '2'],
      [49, '1'],
      [30, '1'],
      [29, '0'],
    ];

    for (const [score, expected] of cases) {
      calls = [];
      resetOdooCache();
      await pushLead({ ...baseLead, leadScore: score });
      expect(createdValues().priority, `score ${score}`).toBe(expected);
    }
  });

  it('puts the score breakdown in the description so a human sees why', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });

    const description = String(createdValues().description);
    expect(description).toContain('100/100');
    expect(description).toContain('Company size: 1000+');
    expect(description).toContain('Audit deadline next month');
    // Attribution — the thing that matters most pre-PPC.
    expect(description).toContain('/frameworks/soc2-checklist');
  });

  it('surfaces attribution, behaviour and context, not just the score', async () => {
    // Capturing this and then not showing it wastes it: a rep would otherwise see a
    // name and an email with no idea how engaged this person is.
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });

    const d = String(createdValues().description);

    // attribution
    expect(d).toContain('google.com'); // referrer
    expect(d).toContain('linkedin'); // first touch
    expect(d).toContain('Cj0KCQtest123'); // gclid, needed for offline conversions

    // behaviour
    expect(d).toContain('47 days'); // long evaluation = high intent in GRC
    expect(d).toContain('92%'); // scroll depth
    expect(d).toContain('Visited pricing');

    // the route they took
    expect(d).toContain('/blog/soc2-guide');
    expect(d).toContain('&rarr;');

    // context
    expect(d).toContain('Berlin');
    expect(d).toContain('Deutsche Telekom');
    expect(d).toContain('Europe/Berlin');
    expect(d).toContain('88.99.100.50');
  });

  it('omits sections with nothing in them', async () => {
    // A footer signup knows almost nothing. The note must not be a wall of empty
    // labels.
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({
      ...baseLead,
      adClickIds: null,
      pageJourney: null,
      visitCount: null,
      pagesViewed: null,
      timeOnSiteSec: null,
      daysSinceFirstVisit: null,
      scrollDepth: null,
      visitedPricing: false,
      geoCity: null,
      geoRegion: null,
      geoIsp: null,
      ipAddress: null,
      deviceType: null,
      browserLanguage: null,
      browserTimezone: null,
      countryCode: null,
    });

    const d = String(createdValues().description);
    expect(d).not.toContain('Behaviour');
    expect(d).not.toContain('Page journey');
    expect(d).not.toContain('Context');
    // but attribution still renders
    expect(d).toContain('Attribution');
  });

  it('flags a hosting or VPN network, which explains an odd reCAPTCHA score', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead, geoIsHosting: true });
    expect(String(createdValues().description)).toContain('hosting / VPN');
  });

  it('escapes HTML in user-supplied text', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead, message: '<script>alert(1)</script>' });

    const description = String(createdValues().description);
    expect(description).not.toContain('<script>');
    expect(description).toContain('&lt;script&gt;');
  });

  it('builds a readable title', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });
    expect(createdValues().name).toBe('Meridian Bank — Demo request');
  });

  it('falls back to the email when there is no company or name', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({
      ...baseLead,
      companyName: null,
      firstName: null,
      lastName: null,
      formId: 'footer_form',
    });
    expect(createdValues().name).toBe('elena@meridian-bank.com — Newsletter signup');
  });
});

describe('relational fields', () => {
  it('resolves UTM values to Odoo ids, creating them when absent', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });

    // Odoo has native UTM models, so attribution reporting works out of the box.
    const created = calls.filter((c) => c.modelMethod === 'create').map((c) => c.model);
    expect(created).toContain('utm.source');
    expect(created).toContain('utm.medium');
    expect(created).toContain('utm.campaign');

    const v = createdValues();
    expect(v.source_id).toBeDefined();
    expect(v.medium_id).toBeDefined();
    expect(v.campaign_id).toBeDefined();
  });

  it('reuses an existing UTM record instead of duplicating it', async () => {
    responses['utm.source.search'] = [42];
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });

    expect(calls.some((c) => c.model === 'utm.source' && c.modelMethod === 'create')).toBe(false);
    expect(createdValues().source_id).toBe(42);
  });

  it('tags the tier and every framework', async () => {
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });

    const tagNames = calls
      .filter((c) => c.model === 'crm.tag' && c.modelMethod === 'create')
      .map((c) => (c.args?.[0] as { name: string }).name);

    expect(tagNames).toContain('enterprise_ae');
    expect(tagNames).toContain('soc2');
    expect(tagNames).toContain('iso27001');

    // Odoo's (6, 0, ids) command replaces the whole many2many set.
    expect(createdValues().tag_ids).toEqual([[6, 0, expect.any(Array)]]);
  });

  it('resolves the country code', async () => {
    responses['res.country.search'] = [56];
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead });
    expect(createdValues().country_id).toBe(56);
  });

  it('still pushes the lead when the sales team does not exist', async () => {
    // Missing team must not block the lead — it just lands on Odoo's default.
    responses['crm.team.search'] = [];
    const { pushLead } = await import('../../src/services/odoo.js');

    const result = await pushLead({ ...baseLead });
    expect(result.created).toBe(true);
    expect(createdValues().team_id).toBeUndefined();
  });

  it('caches lookups instead of repeating them per lead', async () => {
    responses['utm.source.search'] = [42];
    const { pushLead } = await import('../../src/services/odoo.js');

    await pushLead({ ...baseLead });
    const firstCount = calls.filter((c) => c.model === 'utm.source').length;

    calls = [];
    await pushLead({ ...baseLead, email: 'other@corp.com' });
    const secondCount = calls.filter((c) => c.model === 'utm.source').length;

    expect(firstCount).toBeGreaterThan(0);
    expect(secondCount).toBe(0);
  });
});

describe('deduplication', () => {
  it('updates the known record rather than creating a second', async () => {
    responses['crm.lead.search'] = [99];
    const { pushLead } = await import('../../src/services/odoo.js');

    const result = await pushLead({ ...baseLead, existingOdooId: 99 });

    expect(result.created).toBe(false);
    expect(result.odooId).toBe(99);
    expect(calls.some((c) => c.model === 'crm.lead' && c.modelMethod === 'create')).toBe(false);
    expect(calls.some((c) => c.model === 'crm.lead' && c.modelMethod === 'write')).toBe(true);
  });

  it('finds an existing lead by email when we have no stored id', async () => {
    responses['crm.lead.search'] = [77];
    const { pushLead } = await import('../../src/services/odoo.js');

    const result = await pushLead({ ...baseLead, existingOdooId: null });
    expect(result.created).toBe(false);
    expect(result.odooId).toBe(77);
  });

  it('recreates when the stored record was deleted in Odoo', async () => {
    responses['crm.lead.search'] = []; // gone
    const { pushLead } = await import('../../src/services/odoo.js');

    const result = await pushLead({ ...baseLead, existingOdooId: 99 });
    expect(result.created).toBe(true);
  });

  it('logs a chatter message on update instead of overwriting the description', async () => {
    // A human may have written notes. Replacing the description would destroy them.
    responses['crm.lead.search'] = [99];
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead, existingOdooId: 99 });

    const post = calls.find((c) => c.modelMethod === 'message_post');
    expect(post).toBeDefined();
    expect(String(post!.kwargs?.body)).toContain('New submission');
  });

  it('does not overwrite fields a human may have corrected', async () => {
    responses['crm.lead.search'] = [99];
    const { pushLead } = await import('../../src/services/odoo.js');
    await pushLead({ ...baseLead, existingOdooId: 99 });

    const write = calls.find((c) => c.modelMethod === 'write');
    const values = (write?.args?.[1] ?? {}) as Record<string, unknown>;

    // Stage, salesperson and description belong to whoever is working the deal.
    expect(values).not.toHaveProperty('stage_id');
    expect(values).not.toHaveProperty('user_id');
    expect(values).not.toHaveProperty('description');
  });

  it('promotes a Lead to an Opportunity but never demotes', async () => {
    responses['crm.lead.search'] = [99];
    const { pushLead, resetOdooCache } = await import('../../src/services/odoo.js');

    // Nurture lead returns and books a demo -> promoted.
    await pushLead({ ...baseLead, existingOdooId: 99, routingTier: 'enterprise_ae' });
    let write = calls.find((c) => c.modelMethod === 'write');
    expect((write!.args![1] as Record<string, unknown>).type).toBe('opportunity');

    // Existing opportunity signs up to the newsletter -> must NOT drop out of the
    // pipeline.
    calls = [];
    resetOdooCache();
    await pushLead({
      ...baseLead,
      existingOdooId: 99,
      routingTier: 'marketing_drip',
      leadScore: 5,
    });
    write = calls.find((c) => c.modelMethod === 'write');
    expect((write!.args![1] as Record<string, unknown>).type).toBeUndefined();
  });
});
