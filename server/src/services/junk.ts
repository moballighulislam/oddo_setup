/**
 * Junk quarantine.
 *
 * Submissions that fail an anti-bot check are written here instead of to `leads`,
 * so lead counts, exports and CRM pushes are never polluted by spam.
 *
 * The governing constraint is that this must not become a black hole. reCAPTCHA v3
 * scores legitimate traffic low fairly often — corporate VPNs, proxies, privacy
 * browsers, and anyone on a locked-down enterprise network. A CISO submitting the
 * demo form from behind a company VPN can land in here. So:
 *
 *   - the complete payload is stored, not a flag
 *   - `promoteJunkSubmission()` turns a quarantined row back into a real lead
 *   - `listJunkForReview()` exists so someone can actually look
 *
 * Without those three, a junk table silently deletes your best leads.
 */
import { ulid } from 'ulid';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';

export interface QuarantineInput {
  submissionUuid: string;
  formId: string;
  formName: string;
  email: string | null;
  contactName: string | null;
  companyName: string | null;
  rawPayload: unknown;
  botReason: string;
  recaptchaScore: number | null;
  ipAddress: string | null;
  userAgent: string | null;
  geoCountry: string | null;
  pageUrl: string | null;
  referrerUrl: string | null;
}

export interface QuarantineResult {
  publicId: string;
  wasDuplicate: boolean;
}

/**
 * Quarantine a submission.
 *
 * Idempotent on `submissionUuid` for the same reason real submissions are: a bot
 * retrying the same payload must not fill the table with copies.
 */
export async function quarantine(input: QuarantineInput): Promise<QuarantineResult> {
  const existing = await prisma.junkSubmission.findUnique({
    where: { submissionUuid: input.submissionUuid },
    select: { publicId: true },
  });

  if (existing) {
    return { publicId: existing.publicId, wasDuplicate: true };
  }

  const row = await prisma.junkSubmission.create({
    data: {
      publicId: ulid(),
      submissionUuid: input.submissionUuid,
      formId: input.formId,
      formName: input.formName,
      email: input.email,
      contactName: input.contactName,
      companyName: input.companyName,
      rawPayload: JSON.stringify(input.rawPayload),
      botReason: input.botReason,
      recaptchaScore: input.recaptchaScore,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      geoCountry: input.geoCountry,
      pageUrl: input.pageUrl,
      referrerUrl: input.referrerUrl,
    },
  });

  logger.info(
    { junkId: row.publicId, reason: input.botReason, formId: input.formId },
    'submission quarantined as junk',
  );

  return { publicId: row.publicId, wasDuplicate: false };
}

/**
 * Submissions worth a human glance.
 *
 * Ordered by how likely a false positive is. `low_score` comes first because that is
 * reCAPTCHA's judgement rather than a hard signal — a honeypot fill or a sub-second
 * submit is almost certainly a bot, but a low score is frequently just a VPN.
 *
 * Rows already reviewed are excluded so the list stays short enough to actually use.
 */
export async function listJunkForReview(limit = 50) {
  return prisma.junkSubmission.findMany({
    where: { reviewedAt: null, promotedToLeadId: null },
    orderBy: [{ botReason: 'asc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      publicId: true,
      email: true,
      contactName: true,
      companyName: true,
      formId: true,
      botReason: true,
      recaptchaScore: true,
      geoCountry: true,
      createdAt: true,
    },
  });
}

/** Mark a junk row as checked and genuinely junk, so it stops appearing in review. */
export async function markReviewed(publicId: string): Promise<void> {
  await prisma.junkSubmission.updateMany({
    where: { publicId },
    data: { reviewedAt: new Date() },
  });
}

/**
 * Promote a quarantined submission into a real lead.
 *
 * Replays the original payload through the normal submit path, so the promoted lead
 * is scored, routed and pushed to the CRM exactly as it would have been. Nothing is
 * special-cased — which matters, because a hand-built promotion path would drift out
 * of sync with the real one and produce subtly different leads.
 */
export async function promoteJunkSubmission(publicId: string): Promise<{
  promoted: boolean;
  leadId?: number;
  reason?: string;
}> {
  const junk = await prisma.junkSubmission.findUnique({ where: { publicId } });

  if (!junk) return { promoted: false, reason: 'not found' };
  if (junk.promotedToLeadId) {
    return { promoted: true, leadId: junk.promotedToLeadId, reason: 'already promoted' };
  }

  const payload = JSON.parse(junk.rawPayload) as Record<string, unknown>;

  // Imported here rather than at module scope: persist.ts imports the queue, which
  // imports handlers, which import this file. A top-level import would be circular.
  const { persistSubmission } = await import('./persist.js');
  const { normalise } = await import('../schemas/forms.js');
  const { FORM_SCHEMAS } = await import('../schemas/forms.js');
  const { HiddenFieldsSchema } = await import('../schemas/hidden.js');

  const schema = FORM_SCHEMAS[junk.formId as keyof typeof FORM_SCHEMAS];
  if (!schema) return { promoted: false, reason: `unknown form ${junk.formId}` };

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { promoted: false, reason: 'stored payload no longer passes validation' };
  }

  const result = await persistSubmission({
    formId: junk.formId as never,
    formName: junk.formName,
    submissionUuid: junk.submissionUuid,
    data: normalise(junk.formId as never, parsed.data),
    hidden: HiddenFieldsSchema.parse(payload),
    rawPayload: payload,
    ipAddress: junk.ipAddress,
    userAgent: junk.userAgent,
    geoCountry: junk.geoCountry,
    deviceTypeFallback: null,
    // Promotion is a human saying this is real. It enters the pipeline clean.
    isSuspectedBot: false,
    botReason: null,
    recaptchaScore: junk.recaptchaScore,
  });

  await prisma.junkSubmission.update({
    where: { id: junk.id },
    data: { promotedToLeadId: result.leadId, promotedAt: new Date(), reviewedAt: new Date() },
  });

  logger.info(
    { junkId: publicId, leadId: result.leadId, score: result.score },
    'junk submission promoted to lead',
  );

  return { promoted: true, leadId: result.leadId };
}

/**
 * Delete junk older than the retention window.
 *
 * Promoted rows are kept regardless of age — they are the record of a false positive,
 * and the evidence that the anti-bot thresholds need adjusting.
 */
export async function pruneJunk(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

  const result = await prisma.junkSubmission.deleteMany({
    where: { createdAt: { lt: cutoff }, promotedToLeadId: null },
  });

  if (result.count > 0) {
    logger.info({ count: result.count, olderThanDays }, 'pruned junk submissions');
  }
  return result.count;
}

/** Counts by reason, for the health endpoint and for spotting a spam run. */
export async function junkStats(): Promise<Record<string, number>> {
  const rows = await prisma.junkSubmission.groupBy({
    by: ['botReason'],
    _count: { botReason: true },
  });

  const stats: Record<string, number> = {};
  for (const row of rows) stats[row.botReason] = row._count.botReason;

  stats.awaiting_review = await prisma.junkSubmission.count({
    where: { reviewedAt: null, promotedToLeadId: null },
  });
  stats.promoted = await prisma.junkSubmission.count({
    where: { promotedToLeadId: { not: null } },
  });

  return stats;
}
