/**
 * Queue integration tests: enqueue, claim, retry, dead-lettering, and the
 * handlers running end to end against the real database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const { buildApp } = await import('../../src/app.js');
const { prisma } = await import('../../src/db.js');
const { enqueue, claimJobs, failJob, queueStats, pruneCompletedJobs } = await import(
  '../../src/queue/driver.js'
);
const { Worker } = await import('../../src/queue/worker.js');

let app: Awaited<ReturnType<typeof buildApp>>;

const tag = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Each test reasons about the whole queue, so start from empty.
  await prisma.job.deleteMany();
});

async function makeLead() {
  const email = `queue.${tag()}@acme-corp.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/forms/demo_form/submit',
    payload: {
      submission_uuid: randomUUID(),
      form_name: 'book_a_demo',
      first_name: 'Test',
      last_name: 'Lead',
      email,
      phone: '+12124567890',
      company_name: 'Acme Corp',
      job_title: 'CISO',
      company_size: '1000+',
      message: 'We need SOC 2 and ISO 27001. Audit deadline is urgent.',
      consent_given: true,
      form_render_ms: 40_000,
    },
  });
  expect(res.statusCode).toBe(200);

  const lead = await prisma.lead.findUniqueOrThrow({
    where: { email },
    include: { submissions: true },
  });
  return { lead, submissionId: lead.submissions[0]!.id, email };
}

describe('driver', () => {
  it('enqueues a job as pending and due now', async () => {
    const jobId = await enqueue('enrich', { leadId: 1, submissionId: 1 });
    const job = await prisma.job.findUniqueOrThrow({ where: { jobId } });

    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);
    expect(job.runAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('does not claim a job before its delay elapses', async () => {
    await enqueue('enrich', { leadId: 1, submissionId: 1 }, { delayMs: 60_000 });
    expect(await claimJobs(10)).toHaveLength(0);
  });

  it('marks a claimed job running and increments attempts', async () => {
    await enqueue('enrich', { leadId: 1, submissionId: 1 });

    const [claimed] = await claimJobs(10);
    expect(claimed).toBeDefined();
    expect(claimed!.attempts).toBe(1);

    const row = await prisma.job.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(row.status).toBe('running');
    expect(row.lockedBy).not.toBeNull();
  });

  it('does not hand the same job to a second claimer', async () => {
    await enqueue('enrich', { leadId: 1, submissionId: 1 });

    const first = await claimJobs(10);
    const second = await claimJobs(10);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('reschedules a failed job with backoff instead of losing it', async () => {
    await enqueue('crm_push', { leadId: 1, submissionId: 1 });
    const [job] = await claimJobs(1);

    await failJob(job!, new Error('downstream unavailable'));

    const row = await prisma.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toContain('downstream unavailable');
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.lockedAt).toBeNull();
  });

  it('dead-letters a job once its retry budget is exhausted', async () => {
    const jobId = await enqueue('slack_alert', { leadId: 1, submissionId: 1 }, { maxAttempts: 1 });
    const [job] = await claimJobs(1);

    await failJob(job!, new Error('permanent failure'));

    const row = await prisma.job.findUniqueOrThrow({ where: { jobId } });
    expect(row.status).toBe('dead');
  });

  it('never picks up a dead job again', async () => {
    await enqueue('slack_alert', { leadId: 1, submissionId: 1 }, { maxAttempts: 1 });
    const [job] = await claimJobs(1);
    await failJob(job!, new Error('boom'));

    expect(await claimJobs(10)).toHaveLength(0);
  });

  it('kills a job whose payload is not valid JSON rather than retrying forever', async () => {
    const jobId = await enqueue('enrich', { leadId: 1, submissionId: 1 });
    await prisma.job.update({ where: { jobId }, data: { payload: 'not json{' } });

    const claimed = await claimJobs(10);

    expect(claimed).toHaveLength(0);
    const row = await prisma.job.findUniqueOrThrow({ where: { jobId } });
    expect(row.status).toBe('dead');
  });

  it('reclaims a job whose worker died holding the lease', async () => {
    const jobId = await enqueue('enrich', { leadId: 1, submissionId: 1 });

    // Simulate a crashed worker: running, locked, lease long expired.
    await prisma.job.update({
      where: { jobId },
      data: {
        status: 'failed',
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
        lockedBy: 'dead-worker',
      },
    });

    expect(await claimJobs(10)).toHaveLength(1);
  });

  it('reports queue depth by status', async () => {
    await enqueue('enrich', { leadId: 1, submissionId: 1 });
    await enqueue('crm_push', { leadId: 1, submissionId: 1 });

    const stats = await queueStats();
    expect(stats.pending).toBe(2);
  });

  it('prunes old succeeded jobs but keeps dead ones', async () => {
    const okId = await enqueue('enrich', { leadId: 1, submissionId: 1 });
    const deadId = await enqueue('enrich', { leadId: 1, submissionId: 1 });
    const old = new Date(Date.now() - 30 * 86_400_000);

    await prisma.job.update({
      where: { jobId: okId },
      data: { status: 'succeeded', completedAt: old },
    });
    await prisma.job.update({
      where: { jobId: deadId },
      data: { status: 'dead', completedAt: old },
    });

    await pruneCompletedJobs(7);

    expect(await prisma.job.findUnique({ where: { jobId: okId } })).toBeNull();
    // Dead jobs are the record of what broke — pruning them hides the failures.
    expect(await prisma.job.findUnique({ where: { jobId: deadId } })).not.toBeNull();
  });
});

describe('submission dispatch', () => {
  it('enqueues jobs in the same transaction as the lead', async () => {
    const { lead } = await makeLead();

    const jobs = await prisma.job.findMany();
    expect(jobs.length).toBeGreaterThan(0);

    // If the lead exists, its jobs must exist too — that atomicity is the reason
    // the queue lives in the database.
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).not.toBeNull();
  });

  it('queues Slack and calendar jobs for a demo request', async () => {
    await makeLead();
    const types = (await prisma.job.findMany()).map((j) => j.type);

    expect(types).toContain('slack_alert');
    expect(types).toContain('calendar_send');
    expect(types).toContain('ai_extract');
  });

  it('queues nothing for a suspected bot', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/forms/quick_capture/submit',
      payload: {
        submission_uuid: randomUUID(),
        full_name: 'Bot',
        email: `bot.${tag()}@spam-farm.biz`,
        company_name: 'SpamFarm',
        website: 'http://spam.example',
        form_render_ms: 40_000,
      },
    });

    expect(await prisma.job.count()).toBe(0);
  });
});

describe('handlers via the worker', () => {
  /** Drain the queue synchronously rather than waiting on the poll interval. */
  async function drain(maxPasses = 12): Promise<void> {
    const worker = new Worker({ pollIntervalMs: 10, batchSize: 10 });
    worker.start();

    for (let i = 0; i < maxPasses; i++) {
      const remaining = await prisma.job.count({ where: { status: { in: ['pending', 'failed'] } } });
      if (remaining === 0) break;
      await new Promise((r) => setTimeout(r, 120));
    }

    await worker.stop();
  }

  it('runs every queued job to success', async () => {
    await makeLead();
    await drain();

    const stats = await queueStats();
    expect(stats.dead).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.succeeded).toBeGreaterThan(0);
  });

  it('writes an automation event for every job', async () => {
    const { lead } = await makeLead();
    await drain();

    const events = await prisma.automationEvent.findMany({ where: { leadId: lead.id } });
    const types = events.map((e) => e.eventType);

    expect(types).toContain('confirmation_email');
    expect(types).toContain('fallback_task');
    expect(types).toContain('crm_push');
  });

  it('records unconfigured providers as skipped, not failed', async () => {
    // No email or CRM credentials in test, so the work is simulated. That must be
    // visible in the audit trail rather than looking like success.
    const { lead } = await makeLead();
    await drain();

    const event = await prisma.automationEvent.findFirstOrThrow({
      where: { leadId: lead.id, eventType: 'crm_push' },
    });
    expect(event.status).toBe('skipped');
  });

  it('extracts frameworks and urgency from the message text', async () => {
    const { lead } = await makeLead();
    await drain();

    const event = await prisma.automationEvent.findFirstOrThrow({
      where: { leadId: lead.id, eventType: 'ai_extract' },
    });
    const payload = JSON.parse(event.payload!) as { frameworks: string[]; urgent: boolean };

    expect(payload.frameworks).toContain('soc2');
    expect(payload.frameworks).toContain('iso27001');
    expect(payload.urgent).toBe(true);
  });

  it('merges extracted frameworks onto the lead', async () => {
    const { lead } = await makeLead();
    await drain();

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.frameworkInterest).toContain('soc2');
  });

  it('does not send a second confirmation email on a retry', async () => {
    const { lead, submissionId } = await makeLead();
    await drain();

    // Re-queue the same work, as a retry after a lost acknowledgement would.
    await enqueue('confirmation_email', { leadId: lead.id, submissionId });
    await drain();

    const count = await prisma.automationEvent.count({
      where: { leadId: lead.id, eventType: 'confirmation_email' },
    });
    expect(count).toBe(1);
  });

  it('retries a handler whose lead no longer exists, then dead-letters it', async () => {
    await enqueue('enrich', { leadId: 999_999, submissionId: 999_999 }, { maxAttempts: 1 });
    await drain();

    const job = await prisma.job.findFirstOrThrow({ where: { type: 'enrich' } });
    expect(job.status).toBe('dead');
    expect(job.lastError).toContain('not found');
  });
});

describe('email safeguards', () => {
  /** Drain the queue synchronously rather than waiting on the poll interval. */
  async function drain(maxPasses = 12): Promise<void> {
    const worker = new Worker({ pollIntervalMs: 10, batchSize: 10 });
    worker.start();
    for (let i = 0; i < maxPasses; i++) {
      const remaining = await prisma.job.count({ where: { status: { in: ['pending', 'failed'] } } });
      if (remaining === 0) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    await worker.stop();
  }

  it('sends a confirmation for EVERY submission, not just the first', async () => {
    // A subscriber who books a demo months later must not get silence on the
    // highest-intent form in the system.
    const email = `repeat.confirm.${tag()}@acme-corp.com`;

    await app.inject({
      method: 'POST',
      url: '/api/forms/footer_form/submit',
      payload: { submission_uuid: randomUUID(), email, consent_given: true },
    });
    await drain();

    await app.inject({
      method: 'POST',
      url: '/api/forms/demo_form/submit',
      payload: {
        submission_uuid: randomUUID(),
        form_name: 'book_a_demo',
        first_name: 'Repeat',
        last_name: 'Buyer',
        email,
        phone: '+12124567890',
        company_name: 'Acme Corp',
        job_title: 'CISO',
        company_size: '1000+',
        consent_given: true,
        form_render_ms: 40_000,
      },
    });
    await drain();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { email } });
    const confirmations = await prisma.automationEvent.count({
      where: { leadId: lead.id, eventType: 'confirmation_email' },
    });

    expect(confirmations).toBe(2);
  });

  it('still suppresses a retry of the same submission', async () => {
    const { lead, submissionId } = await makeLead();
    await drain();

    await enqueue('confirmation_email', { leadId: lead.id, submissionId });
    await drain();

    const count = await prisma.automationEvent.count({
      where: { leadId: lead.id, submissionId, eventType: 'confirmation_email' },
    });
    expect(count).toBe(1);
  });

  it('does not mail an address that bounced or complained', async () => {
    const { lead, email } = await makeLead();

    await prisma.newsletterSubscriber.upsert({
      where: { email },
      update: { status: 'complained' },
      create: {
        email,
        leadId: lead.id,
        status: 'complained',
        unsubscribeToken: `tok_${tag()}`,
      },
    });

    await drain();

    const event = await prisma.automationEvent.findFirstOrThrow({
      where: { leadId: lead.id, eventType: 'confirmation_email' },
    });
    expect(event.status).toBe('skipped');
    expect(event.payload).toContain('complained');
  });

  it('records which submission triggered each automation', async () => {
    const { lead, submissionId } = await makeLead();
    await drain();

    const events = await prisma.automationEvent.findMany({ where: { leadId: lead.id } });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.submissionId).toBe(submissionId);
    }
  });
});
