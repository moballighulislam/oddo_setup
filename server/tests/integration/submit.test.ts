/**
 * End-to-end tests for the submit endpoint.
 *
 * Runs against the real SQLite database via app.inject(), so no port is bound.
 * Each test uses a unique email so runs do not collide, and the rate limiter is
 * raised out of the way — it has its own test below.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.RATE_LIMIT_MAX = '10000';
process.env.NODE_ENV = 'test';

const { buildApp } = await import('../../src/app.js');
const { prisma } = await import('../../src/db.js');

let app: Awaited<ReturnType<typeof buildApp>>;

/** Unique per run so repeated test runs never collide on the email unique index. */
const tag = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function post(formId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/forms/${formId}/submit`,
    payload: body,
  });
}

function demoPayload(overrides: Record<string, unknown> = {}) {
  const t = tag();
  return {
    submission_uuid: randomUUID(),
    form_name: 'book_a_demo',
    first_name: 'Elena',
    last_name: 'Fischer',
    email: `elena.${t}@meridian-bank.com`,
    phone: '+49 30 12345678',
    company_name: 'Meridian Bank',
    job_title: 'Chief Information Security Officer',
    company_size: '1000+',
    consent_given: true,
    form_render_ms: 45_000,
    ...overrides,
  };
}

describe('POST /api/forms/:formId/submit', () => {
  it('accepts a valid demo submission and returns an opaque id', async () => {
    const res = await post('demo_form', demoPayload());
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.submission_id).toBeTruthy();
  });

  it('does not leak the score, tier or assignee to the browser', async () => {
    const body = (await post('demo_form', demoPayload())).json();
    expect(body).not.toHaveProperty('score');
    expect(body).not.toHaveProperty('routing_tier');
    expect(body).not.toHaveProperty('assigned_to');
  });

  it('writes lead, submission and tracking rows together', async () => {
    const payload = demoPayload({ utm_source: 'google', utm_campaign: 'grc_q4' });
    await post('demo_form', payload);

    const lead = await prisma.lead.findUnique({
      where: { email: payload.email as string },
      include: { submissions: { include: { tracking: true } } },
    });

    expect(lead).not.toBeNull();
    expect(lead!.submissions).toHaveLength(1);
    expect(lead!.submissions[0]!.tracking).not.toBeNull();
    expect(lead!.submissions[0]!.tracking!.utmSource).toBe('google');
  });

  it('scores a CISO at a 1000+ company into the enterprise tier with a 1 hour SLA', async () => {
    const payload = demoPayload({ visited_pricing: true, visit_count: 3, pages_viewed: 8 });
    await post('demo_form', payload);

    const lead = await prisma.lead.findUnique({ where: { email: payload.email as string } });
    expect(lead!.leadScore).toBeGreaterThanOrEqual(80);
    expect(lead!.routingTier).toBe('enterprise_ae');
    expect(lead!.slaDueAt).not.toBeNull();

    const minutes = (lead!.slaDueAt!.getTime() - lead!.createdAt.getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(55);
    expect(minutes).toBeLessThan(65);
  });

  it('keeps the score ledger consistent with the rollup', async () => {
    const payload = demoPayload();
    await post('demo_form', payload);

    const lead = await prisma.lead.findUnique({
      where: { email: payload.email as string },
      include: { scores: true },
    });

    const sum = lead!.scores.reduce((acc, s) => acc + s.points, 0);
    expect(sum).toBe(lead!.leadScore);
  });

  describe('idempotency', () => {
    it('replays the original response for a repeated submission_uuid', async () => {
      const payload = demoPayload();

      const first = await post('demo_form', payload);
      const second = await post('demo_form', payload);

      expect(second.statusCode).toBe(200);
      expect(second.json().submission_id).toBe(first.json().submission_id);

      const count = await prisma.formSubmission.count({
        where: { submissionUuid: payload.submission_uuid as string },
      });
      expect(count).toBe(1);
    });

    it('links a second genuine submission to the same lead', async () => {
      const email = `repeat.${tag()}@acme-corp.com`;

      await post('footer_form', { submission_uuid: randomUUID(), email });
      await post('demo_form', demoPayload({ email, submission_uuid: randomUUID() }));

      const lead = await prisma.lead.findUnique({
        where: { email },
        include: { submissions: true },
      });
      expect(lead!.submissions).toHaveLength(2);
    });

    it('fills profile gaps on a later submission without erasing known values', async () => {
      const email = `progressive.${tag()}@acme-corp.com`;

      await post('footer_form', { submission_uuid: randomUUID(), email });
      let lead = await prisma.lead.findUnique({ where: { email } });
      expect(lead!.jobTitle).toBeNull();

      await post('demo_form', demoPayload({ email, submission_uuid: randomUUID() }));
      lead = await prisma.lead.findUnique({ where: { email } });

      expect(lead!.jobTitle).toBe('Chief Information Security Officer');
      expect(lead!.companySize).toBe('1000+');
    });
  });

  describe('validation', () => {
    it('returns field-level errors for a missing required field', async () => {
      const res = await post('demo_form', {
        submission_uuid: randomUUID(),
        email: 'x@acme-corp.com',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_failed');
      expect(res.json().fields).toHaveProperty('first_name');
    });

    it('404s an unknown form template', async () => {
      const res = await post('not_a_form', { submission_uuid: randomUUID() });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('unknown_form');
    });

    it('rejects a personal email on a lead form', async () => {
      const res = await post(
        'demo_form',
        demoPayload({ email: `someone.${tag()}@gmail.com` }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('personal_email');
    });

    it('allows a personal email on the newsletter form', async () => {
      const res = await post('footer_form', {
        submission_uuid: randomUUID(),
        email: `practitioner.${tag()}@gmail.com`,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('anti-bot quarantine', () => {
    it('quarantines a honeypot hit without telling the bot', async () => {
      const email = `bot.${tag()}@spamco-domain.biz`;
      const res = await post('quick_capture', {
        submission_uuid: randomUUID(),
        full_name: 'Bot Bot',
        email,
        company_name: 'SpamCo',
        website: 'http://spam.example', // honeypot
        form_render_ms: 30_000,
      });

      // The bot sees a normal success response — telling it otherwise only helps it.
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const junk = await prisma.junkSubmission.findFirst({ where: { email } });
      expect(junk).not.toBeNull();
      expect(junk!.botReason).toBe('honeypot');
    });

    it('keeps junk out of the leads table entirely', async () => {
      // The whole point: lead counts, exports and CRM pushes stay clean.
      const email = `bot.leads.${tag()}@spamco-domain.biz`;
      await post('quick_capture', {
        submission_uuid: randomUUID(),
        full_name: 'Bot',
        email,
        company_name: 'SpamCo',
        website: 'spam',
        form_render_ms: 30_000,
      });

      expect(await prisma.lead.findUnique({ where: { email } })).toBeNull();
      expect(await prisma.formSubmission.count({ where: { lead: { email } } })).toBe(0);
    });

    it('quarantines a submission faster than a human could type', async () => {
      const email = `fast.${tag()}@speedy-domain.com`;
      await post('quick_capture', {
        submission_uuid: randomUUID(),
        full_name: 'Fast Bot',
        email,
        company_name: 'Speedy',
        form_render_ms: 800,
      });

      const junk = await prisma.junkSubmission.findFirst({ where: { email } });
      expect(junk!.botReason).toBe('too_fast');
    });

    it('stores the full payload so a false positive can be recovered', async () => {
      // reCAPTCHA scores corporate VPNs low. Without the payload there is no way
      // back and the table becomes a black hole.
      const email = `vpn.ciso.${tag()}@enterprise-corp.com`;
      await post('demo_form', {
        ...demoPayload({ email }),
        website: 'triggered',
      });

      const junk = await prisma.junkSubmission.findFirstOrThrow({ where: { email } });
      const payload = JSON.parse(junk.rawPayload) as Record<string, unknown>;

      expect(payload.job_title).toBe('Chief Information Security Officer');
      expect(payload.company_size).toBe('1000+');
      expect(junk.companyName).toBe('Meridian Bank');
    });

    it('promotes a false positive into a fully scored lead', async () => {
      const email = `promote.${tag()}@enterprise-corp.com`;
      await post('demo_form', { ...demoPayload({ email }), website: 'triggered' });

      const junk = await prisma.junkSubmission.findFirstOrThrow({ where: { email } });

      const { promoteJunkSubmission } = await import('../../src/services/junk.js');
      const result = await promoteJunkSubmission(junk.publicId);

      expect(result.promoted).toBe(true);

      // Replayed through the normal path, so it is scored and routed identically.
      const lead = await prisma.lead.findUniqueOrThrow({ where: { email } });
      expect(lead.leadScore).toBeGreaterThanOrEqual(80);
      expect(lead.routingTier).toBe('enterprise_ae');

      const updated = await prisma.junkSubmission.findUniqueOrThrow({
        where: { id: junk.id },
      });
      expect(updated.promotedToLeadId).toBe(lead.id);
    });

    it('does not promote the same submission twice', async () => {
      const email = `promote.once.${tag()}@enterprise-corp.com`;
      await post('demo_form', { ...demoPayload({ email }), website: 'triggered' });

      const junk = await prisma.junkSubmission.findFirstOrThrow({ where: { email } });
      const { promoteJunkSubmission } = await import('../../src/services/junk.js');

      const first = await promoteJunkSubmission(junk.publicId);
      const second = await promoteJunkSubmission(junk.publicId);

      expect(second.leadId).toBe(first.leadId);
      expect(await prisma.lead.count({ where: { email } })).toBe(1);
    });

    it('is idempotent — a bot retrying the same uuid makes one row', async () => {
      const uuid = randomUUID();
      const payload = {
        submission_uuid: uuid,
        full_name: 'Repeat Bot',
        email: `repeat.bot.${tag()}@spamco-domain.biz`,
        company_name: 'SpamCo',
        website: 'spam',
        form_render_ms: 30_000,
      };

      await post('quick_capture', payload);
      await post('quick_capture', payload);

      expect(await prisma.junkSubmission.count({ where: { submissionUuid: uuid } })).toBe(1);
    });

    it('never subscribes quarantined submissions to the newsletter', async () => {
      const email = `botnews.${tag()}@spamco-domain.biz`;
      await post('footer_form', {
        submission_uuid: randomUUID(),
        email,
        consent_given: true,
        website: 'spam',
      });

      expect(await prisma.newsletterSubscriber.findUnique({ where: { email } })).toBeNull();
    });

    it('reports junk counts by reason', async () => {
      const { junkStats } = await import('../../src/services/junk.js');
      const stats = await junkStats();
      expect(stats).toHaveProperty('awaiting_review');
    });
  });

  describe('server-owned fields', () => {
    it('ignores a client-supplied score, tier and assignee', async () => {
      const email = `attacker.${tag()}@evil-corp.com`;
      await post('footer_form', {
        submission_uuid: randomUUID(),
        email,
        lead_score: 100,
        assigned_to: 'ceo@company.com',
        routing_tier: 'enterprise_ae',
      });

      const lead = await prisma.lead.findUnique({ where: { email } });
      expect(lead!.leadScore).toBeLessThan(30);
      expect(lead!.routingTier).toBe('marketing_drip');
      expect(lead!.assignedTo).not.toBe('ceo@company.com');
    });
  });

  describe('routing bypass', () => {
    it('routes a support inquiry to support, not to sales', async () => {
      const email = `support.${tag()}@customer-corp.com`;
      await post('contact_form', {
        submission_uuid: randomUUID(),
        form_name: 'contact_us',
        first_name: 'Tara',
        last_name: 'Whitfield',
        email,
        phone: '+15551234567',
        company_name: 'Orion Logistics',
        job_title: 'IT Director',
        inquiry_type: 'support',
        message: 'SSO login failing for three users.',
        form_render_ms: 60_000,
      });

      const lead = await prisma.lead.findUnique({ where: { email } });
      expect(lead!.routingTier).toBe('bypass_support');
      expect(lead!.leadStatus).toBe('disqualified');
    });
  });

  describe('newsletter and consent', () => {
    it('subscribes a footer signup', async () => {
      const email = `news.${tag()}@acme-corp.com`;
      await post('footer_form', { submission_uuid: randomUUID(), email, consent_given: true });

      const sub = await prisma.newsletterSubscriber.findUnique({ where: { email } });
      expect(sub!.status).toBe('subscribed');
      expect(sub!.unsubscribeToken.length).toBeGreaterThan(20);
    });

    it('does not subscribe a demo request that withheld consent', async () => {
      const payload = demoPayload({ consent_given: false });
      await post('demo_form', payload);

      const sub = await prisma.newsletterSubscriber.findUnique({
        where: { email: payload.email as string },
      });
      expect(sub).toBeNull();
    });

    it('records the consent IP and timestamp when consent is given', async () => {
      const payload = demoPayload({ consent_given: true, consent_text_version: 'v2' });
      await post('demo_form', payload);

      const lead = await prisma.lead.findUnique({ where: { email: payload.email as string } });
      expect(lead!.consentGiven).toBe(true);
      expect(lead!.consentAt).not.toBeNull();
      expect(lead!.consentTextVersion).toBe('v2');
    });

    it('never resurrects someone who already unsubscribed', async () => {
      const email = `resurrect.${tag()}@acme-corp.com`;

      await post('footer_form', { submission_uuid: randomUUID(), email, consent_given: true });
      await prisma.newsletterSubscriber.update({
        where: { email },
        data: { status: 'unsubscribed', unsubscribedAt: new Date() },
      });

      // A later form submission must not silently re-subscribe them.
      await post('footer_form', { submission_uuid: randomUUID(), email, consent_given: true });

      const sub = await prisma.newsletterSubscriber.findUnique({ where: { email } });
      expect(sub!.status).toBe('unsubscribed');
    });
  });
});

describe('GET /health', () => {
  it('reports ok when the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.database).toBe('ok');
  });
});
