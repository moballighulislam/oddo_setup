/**
 * Decides which jobs a submission triggers.
 *
 * Kept separate from the submit route and from the handlers so the fan-out rules
 * are readable in one place and testable without a database.
 *
 * The governing rule from the spec: Layer 1 automations key on `form_id` and
 * `inquiry_type` alone, never on `lead_score`. They must fire even if scoring or
 * routing fails.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { enqueueMany } from './driver.js';
import type { JobType } from './types.js';
import type { FormId } from '../schemas/enums.js';

export interface DispatchFacts {
  leadId: number;
  submissionId: number;
  formId: FormId;
  inquiryType?: string | undefined;
  isSuspectedBot: boolean;
  hasMessage: boolean;
}

export interface PlannedJob {
  type: JobType;
  payload: Record<string, unknown>;
  options?: { delayMs?: number };
}

/**
 * Work out the job list for a submission.
 *
 * Pure — returns a plan rather than enqueueing it, so the rules can be asserted
 * directly in tests.
 */
export function planJobs(facts: DispatchFacts): PlannedJob[] {
  const payload = { leadId: facts.leadId, submissionId: facts.submissionId };
  const jobs: PlannedJob[] = [];

  // A flagged submission is stored and visible but generates no outbound contact.
  // Enriching or CRM-pushing spam wastes API quota and pollutes the CRM.
  if (facts.isSuspectedBot) {
    return jobs;
  }

  // Always: normalise phone, fill in company domain and geo.
  jobs.push({ type: 'enrich', payload });

  // Always: acknowledge the submission. Silence reads as immaturity to a
  // compliance-focused buyer.
  jobs.push({ type: 'confirmation_email', payload });

  // Always: the safety net, so nothing sits untouched if scoring or routing broke.
  jobs.push({ type: 'fallback_task', payload });

  // Always: get the lead in front of sales.
  jobs.push({ type: 'crm_push', payload });

  // High-intent only. Scoped this narrowly on purpose — alerting on every footer
  // signup trains the team to ignore the channel, and then the alerts that matter
  // get ignored too.
  const isDemoIntent =
    facts.formId === 'demo_form' ||
    (facts.formId === 'contact_form' && facts.inquiryType === 'request_demo');

  if (isDemoIntent) {
    jobs.push({ type: 'slack_alert', payload });
    jobs.push({ type: 'calendar_send', payload });
  }

  // Only when there is text to parse.
  if (facts.hasMessage) {
    jobs.push({ type: 'ai_extract', payload });
  }

  return jobs;
}

/**
 * Plan and enqueue in one step.
 *
 * Takes a transaction client so the jobs commit atomically with the lead. That is
 * the whole reason this queue lives in the database: if the process dies
 * immediately after responding, the work is still queued.
 */
export async function dispatchForSubmission(
  facts: DispatchFacts,
  tx?: Prisma.TransactionClient | PrismaClient,
): Promise<string[]> {
  const planned = planJobs(facts);
  if (planned.length === 0) return [];

  return enqueueMany(
    planned.map((job) => ({
      type: job.type,
      payload: job.payload,
      options: job.options ?? {},
    })),
    tx,
  );
}
