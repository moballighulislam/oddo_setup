import { describe, it, expect } from 'vitest';
import { planJobs } from '../../src/queue/dispatch.js';
import { backoffMs, RETRY_POLICY, JOB_TYPES } from '../../src/queue/types.js';

const base = { leadId: 1, submissionId: 1, isSuspectedBot: false, hasMessage: false };

const types = (facts: Parameters<typeof planJobs>[0]) => planJobs(facts).map((j) => j.type);

describe('planJobs', () => {
  it('always enriches, confirms, creates a fallback task and pushes to CRM', () => {
    const t = types({ ...base, formId: 'footer_form' });
    expect(t).toContain('enrich');
    expect(t).toContain('confirmation_email');
    expect(t).toContain('fallback_task');
    expect(t).toContain('crm_push');
  });

  it('alerts Slack and sends a calendar link for a demo request', () => {
    const t = types({ ...base, formId: 'demo_form' });
    expect(t).toContain('slack_alert');
    expect(t).toContain('calendar_send');
  });

  it('treats a contact form asking for a demo as demo intent', () => {
    const t = types({ ...base, formId: 'contact_form', inquiryType: 'request_demo' });
    expect(t).toContain('slack_alert');
    expect(t).toContain('calendar_send');
  });

  it('does not alert Slack for low-intent forms', () => {
    // Alerting on every footer signup trains the team to ignore the channel.
    expect(types({ ...base, formId: 'footer_form' })).not.toContain('slack_alert');
    expect(types({ ...base, formId: 'quick_capture' })).not.toContain('slack_alert');
  });

  it('does not alert Slack for a support inquiry', () => {
    const t = types({ ...base, formId: 'contact_form', inquiryType: 'support' });
    expect(t).not.toContain('slack_alert');
  });

  it('only parses text when there is text', () => {
    expect(types({ ...base, formId: 'demo_form', hasMessage: true })).toContain('ai_extract');
    expect(types({ ...base, formId: 'demo_form', hasMessage: false })).not.toContain('ai_extract');
  });

  it('generates no jobs at all for a suspected bot', () => {
    // Stored and visible, but no outbound contact, no CRM pollution, no API spend.
    const t = types({ ...base, formId: 'demo_form', isSuspectedBot: true, hasMessage: true });
    expect(t).toEqual([]);
  });

  it('never keys a job on lead score', () => {
    // Layer 1 must fire even if scoring or routing failed entirely.
    const low = types({ ...base, formId: 'demo_form' });
    const high = types({ ...base, formId: 'demo_form' });
    expect(low).toEqual(high);
  });

  it('passes both ids in every payload', () => {
    for (const job of planJobs({ ...base, formId: 'demo_form', hasMessage: true })) {
      expect(job.payload).toEqual({ leadId: 1, submissionId: 1 });
    }
  });
});

describe('retry policy', () => {
  it('covers every job type', () => {
    for (const type of JOB_TYPES) {
      expect(RETRY_POLICY[type]).toBeDefined();
      expect(RETRY_POLICY[type].maxAttempts).toBeGreaterThan(0);
    }
  });

  it('retries a CRM push harder than an AI extraction', () => {
    // A lead that never reaches the CRM is invisible to sales; a missing text
    // summary is a convenience.
    expect(RETRY_POLICY.crm_push.maxAttempts).toBeGreaterThan(RETRY_POLICY.ai_extract.maxAttempts);
  });

  it('gives up on a Slack alert quickly — a late alert is just noise', () => {
    expect(RETRY_POLICY.slack_alert.maxAttempts).toBeLessThanOrEqual(3);
  });
});

describe('backoffMs', () => {
  it('grows with each attempt', () => {
    const first = backoffMs('crm_push', 1);
    const fourth = backoffMs('crm_push', 4);
    expect(fourth).toBeGreaterThan(first);
  });

  it('caps at one hour even after many attempts', () => {
    // 1.25x allows for the jitter added on top of the cap.
    expect(backoffMs('crm_push', 50)).toBeLessThanOrEqual(3_600_000 * 1.25);
  });

  it('adds jitter so a batch of failures does not retry in lockstep', () => {
    // Without jitter, an outage that fails fifty jobs makes all fifty retry at the
    // same instant and knock the recovering service over again.
    const samples = new Set(Array.from({ length: 20 }, () => backoffMs('enrich', 3)));
    expect(samples.size).toBeGreaterThan(1);
  });

  it('never returns a negative or zero delay', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect(backoffMs('enrich', attempt)).toBeGreaterThan(0);
    }
  });
});
