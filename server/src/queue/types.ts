/**
 * Job type definitions and payload contracts.
 *
 * Payloads carry IDs, never whole records. A job may run minutes after it was
 * enqueued, and by then a snapshot of the lead is stale — the handler re-reads
 * current state instead of trusting what the enqueuer saw.
 */
import { z } from 'zod';

export const JOB_TYPES = [
  /** Geolocation, company data from the email domain, E.164 phone normalisation. */
  'enrich',
  /** Per-form confirmation email to the submitter. Fires for every form. */
  'confirmation_email',
  /** Slack alert to the sales team. Demo forms and demo inquiries only. */
  'slack_alert',
  /** Self-book scheduling link, attached to the demo confirmation. */
  'calendar_send',
  /** Safety net: a "review new lead" task, so nothing sits untouched. */
  'fallback_task',
  /** Push the lead to the CRM. No-op logger until a vendor is chosen. */
  'crm_push',
  /** Parse framework, urgency and team size out of a free-text message. */
  'ai_extract',
] as const;

export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Every job payload carries these. `leadId` is what handlers key on; `submissionId`
 * identifies which specific touch triggered the work.
 */
export const BaseJobPayloadSchema = z.object({
  leadId: z.number().int().positive(),
  submissionId: z.number().int().positive(),
});

export type BaseJobPayload = z.infer<typeof BaseJobPayloadSchema>;

/**
 * Per-type retry policy.
 *
 * The numbers encode how much a failure matters rather than how likely it is:
 *
 *  - `crm_push` retries hardest. A lead that never reaches the CRM is invisible to
 *    sales, which is the worst outcome in the system.
 *  - `ai_extract` retries least. It is a convenience for the SDR reading the record;
 *    hammering a paid API for a nice-to-have is not worth it.
 *  - `slack_alert` gives up quickly. A late alert is noise — by the time three
 *    retries have elapsed the moment has passed.
 */
export const RETRY_POLICY: Record<JobType, { maxAttempts: number; baseDelayMs: number }> = {
  enrich: { maxAttempts: 3, baseDelayMs: 5_000 },
  confirmation_email: { maxAttempts: 5, baseDelayMs: 10_000 },
  slack_alert: { maxAttempts: 3, baseDelayMs: 5_000 },
  calendar_send: { maxAttempts: 5, baseDelayMs: 10_000 },
  fallback_task: { maxAttempts: 3, baseDelayMs: 5_000 },
  crm_push: { maxAttempts: 8, baseDelayMs: 15_000 },
  ai_extract: { maxAttempts: 2, baseDelayMs: 30_000 },
};

/**
 * Exponential backoff with jitter, capped at one hour.
 *
 * The jitter matters: without it, a downstream outage that fails fifty jobs at once
 * makes all fifty retry at the same instant, and the recovering service is hit by
 * exactly the thundering herd that knocked it over.
 */
export function backoffMs(type: JobType, attempt: number): number {
  const { baseDelayMs } = RETRY_POLICY[type];
  const exponential = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(exponential, 3_600_000);
  const jitter = capped * 0.25 * Math.random();
  return Math.round(capped + jitter);
}
