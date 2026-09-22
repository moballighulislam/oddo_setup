/**
 * Job handlers — Automation Layer 1.
 *
 * Every handler follows the same contract:
 *   - reads current state from the database rather than trusting the payload
 *   - writes an automation_event row recording what it did
 *   - throws on failure, so the driver can retry it
 *
 * Handlers must be idempotent. A retry after a timeout may run work that already
 * succeeded, so anything with an external side effect checks the audit trail first.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { emailDomain } from '../services/antibot.js';
import {
  pushToCrm,
  sendEmail,
  sendSlackAlert,
  unsubscribeUrl,
} from '../services/providers.js';
import type { EventType } from '../schemas/enums.js';
import type { JobType } from './types.js';

export type JobHandler = (payload: Record<string, unknown>, jobId: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

async function recordEvent(
  leadId: number,
  submissionId: number | null,
  eventType: EventType,
  status: 'success' | 'skipped' | 'failed',
  jobId: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await prisma.automationEvent.create({
    data: {
      leadId,
      submissionId,
      eventType,
      status,
      jobId,
      payload: payload ? JSON.stringify(payload) : null,
      completedAt: new Date(),
    },
  });
}

/**
 * Has this side effect already been handled for THIS SUBMISSION?
 *
 * Guards against a retry re-sending an email that actually went out but whose
 * acknowledgement was lost.
 *
 * Scoped to the submission, not the lead. Scoping per lead looks safer but is
 * worse: a subscriber who books a demo months later would get silence on the
 * highest-intent form in the system. Each submission earns its own acknowledgement;
 * only a retry of the same submission is suppressed.
 *
 * Matches 'skipped' as well as 'success'. Both mean the handler reached a decision
 * and that decision stands — 'skipped' covers a deliberate no-send (suspected bot,
 * provider not configured). Only a genuine 'failed' event leaves work outstanding.
 */
async function alreadyDone(
  leadId: number,
  submissionId: number,
  eventType: EventType,
): Promise<boolean> {
  const existing = await prisma.automationEvent.findFirst({
    where: { leadId, submissionId, eventType, status: { in: ['success', 'skipped'] } },
    select: { id: true },
  });
  return existing !== null;
}

function requireIds(payload: Record<string, unknown>): { leadId: number; submissionId: number } {
  const leadId = Number(payload.leadId);
  const submissionId = Number(payload.submissionId);
  if (!Number.isInteger(leadId) || !Number.isInteger(submissionId)) {
    throw new Error('job payload is missing leadId or submissionId');
  }
  return { leadId, submissionId };
}

// ---------------------------------------------------------------------------
// enrich — geolocation, company data, phone normalisation
// ---------------------------------------------------------------------------

const enrich: JobHandler = async (payload) => {
  const { leadId, submissionId } = requireIds(payload);

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error(`lead ${leadId} not found`);

  const updates: Record<string, unknown> = {};

  // Geolocation. MaxMind is not wired up — the country from the tracking row is
  // used where Cloudflare supplied one. Read first because phone parsing needs it.
  const tracking = await prisma.trackingData.findUnique({ where: { submissionId } });
  const countryHint = lead.countryCode ?? tracking?.geoCountry ?? null;

  if (tracking?.geoCountry && !lead.countryCode) {
    updates.countryCode = tracking.geoCountry;
  }

  // Phone -> E.164. Stored raw at submit time because rejecting "+49 30 12345678"
  // for its spaces would have lost the lead; normalising is this job's work.
  //
  // A bare national number is ambiguous without knowing the country, and guessing
  // wrong corrupts the number rather than leaving it merely unformatted. So a
  // national number is only parsed when there is a real country signal — otherwise
  // it stays exactly as the visitor typed it, which a human can still dial.
  if (lead.phoneE164 && !lead.phoneE164.startsWith('+')) {
    if (countryHint) {
      const parsed = parsePhoneNumberFromString(lead.phoneE164, countryHint as never);
      if (parsed?.isValid()) {
        updates.phoneE164 = parsed.number;
      }
    }
  } else if (lead.phoneE164) {
    // Already international: safe to normalise without a country hint.
    const parsed = parsePhoneNumberFromString(lead.phoneE164);
    if (parsed?.isValid() && parsed.number !== lead.phoneE164) {
      updates.phoneE164 = parsed.number;
    }
  }

  // Company domain from the email, when the submit path did not set it.
  if (!lead.companyDomain) {
    updates.companyDomain = emailDomain(lead.email);
  }

  if (Object.keys(updates).length > 0) {
    await prisma.lead.update({ where: { id: leadId }, data: updates });
  }

  logger.debug({ leadId, updates: Object.keys(updates) }, 'lead enriched');
};

// ---------------------------------------------------------------------------
// confirmation_email — fires for every form, keyed on form_id
// ---------------------------------------------------------------------------

/**
 * Per-template copy. Silence after a form submit reads as immaturity to a
 * compliance-focused buyer, so every template gets an immediate reply.
 */
const CONFIRMATION_COPY: Record<string, { subject: string; body: string }> = {
  quick_capture: {
    subject: 'Thanks — a GRC expert will be in touch',
    body: 'Thanks for reaching out. One of our compliance specialists will contact you within one business day.',
  },
  footer_form: {
    subject: "You're subscribed to GRC insights",
    body: 'Thanks for subscribing. Expect practical guidance on SOC 2, ISO 27001 and the frameworks that matter to your team.',
  },
  demo_form: {
    subject: 'Your demo request — book a time',
    body: 'Thanks for requesting a demo. Use the link below to pick a time that suits you, and we will tailor the session to your framework and timeline.',
  },
  contact_form: {
    subject: "We've received your message",
    body: 'Thanks for getting in touch. Your message has been routed to the right team and you will hear back shortly.',
  },
};

const confirmationEmail: JobHandler = async (payload, jobId) => {
  const { leadId, submissionId } = requireIds(payload);

  if (await alreadyDone(leadId, submissionId, 'confirmation_email')) {
    logger.debug({ leadId }, 'confirmation email already sent — skipping');
    return;
  }

  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: { lead: { include: { subscriber: true } } },
  });
  if (!submission) throw new Error(`submission ${submissionId} not found`);

  // A flagged submission gets no outbound mail. Auto-replying to a spam run makes
  // this service a spam amplifier and damages sending reputation.
  if (submission.isSuspectedBot) {
    await recordEvent(leadId, submissionId, 'confirmation_email', 'skipped', jobId, {
      reason: 'suspected bot',
    });
    return;
  }

  // Suppression. A confirmation is transactional, so it is still sent to someone
  // who unsubscribed from marketing — they asked for this specific reply by
  // submitting the form seconds ago. But a hard bounce or a spam complaint is
  // different: continuing to mail those addresses damages sending reputation for
  // every other recipient, so they are suppressed outright.
  const subscriberStatus = submission.lead.subscriber?.status;
  if (subscriberStatus === 'bounced' || subscriberStatus === 'complained') {
    await recordEvent(leadId, submissionId, 'confirmation_email', 'skipped', jobId, {
      reason: `suppressed: ${subscriberStatus}`,
    });
    return;
  }

  const copy = CONFIRMATION_COPY[submission.formId] ?? CONFIRMATION_COPY.contact_form!;
  let body = copy.body;

  if (submission.formId === 'demo_form' && env.CALENDAR_BOOKING_URL) {
    body += `\n\nBook your session: ${env.CALENDAR_BOOKING_URL}`;
  }

  const token = submission.lead.subscriber?.unsubscribeToken;

  const result = await sendEmail({
    to: submission.lead.email,
    subject: copy.subject,
    body,
    ...(token ? { unsubscribeUrl: unsubscribeUrl(token) } : {}),
  });

  await recordEvent(
    leadId,
    submissionId,
    'confirmation_email',
    result.simulated ? 'skipped' : 'success',
    jobId,
    { formId: submission.formId, simulated: result.simulated },
  );
};

// ---------------------------------------------------------------------------
// slack_alert — high-intent forms only
// ---------------------------------------------------------------------------

const slackAlert: JobHandler = async (payload, jobId) => {
  const { leadId, submissionId } = requireIds(payload);

  if (await alreadyDone(leadId, submissionId, 'slack_alert')) return;

  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: { lead: true, tracking: true },
  });
  if (!submission) throw new Error(`submission ${submissionId} not found`);

  if (submission.isSuspectedBot) {
    await recordEvent(leadId, submissionId, 'slack_alert', 'skipped', jobId, {
      reason: 'suspected bot',
    });
    return;
  }

  const lead = submission.lead;

  const result = await sendSlackAlert({
    text: `New ${submission.formId.replace(/_/g, ' ')} — score ${lead.leadScore} (${lead.routingTier})`,
    fields: {
      Name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—',
      Company: lead.companyName ?? '—',
      'Job title': lead.jobTitle ?? '—',
      'Company size': lead.companySize ?? '—',
      Score: String(lead.leadScore),
      Tier: lead.routingTier ?? '—',
      'SLA due': lead.slaDueAt?.toISOString() ?? 'none',
      Page: submission.tracking?.pageUrl ?? '—',
      Source: submission.tracking?.utmSource ?? 'direct',
    },
  });

  await recordEvent(leadId, submissionId, 'slack_alert', result.simulated ? 'skipped' : 'success', jobId, {
    simulated: result.simulated,
  });
};

// ---------------------------------------------------------------------------
// calendar_send — demo requests only
// ---------------------------------------------------------------------------

const calendarSend: JobHandler = async (payload, jobId) => {
  const { leadId, submissionId } = requireIds(payload);

  if (!env.CALENDAR_BOOKING_URL) {
    await recordEvent(leadId, submissionId, 'calendar_send', 'skipped', jobId, {
      reason: 'CALENDAR_BOOKING_URL not configured',
    });
    return;
  }

  // The link rides along with the confirmation email rather than arriving as a
  // second message. Two emails in one minute reads as automation noise.
  await recordEvent(leadId, submissionId, 'calendar_send', 'success', jobId, {
    attachedTo: 'confirmation_email',
  });
};

// ---------------------------------------------------------------------------
// fallback_task — the safety net
// ---------------------------------------------------------------------------

/**
 * Guarantees no lead sits untouched even if scoring or routing failed.
 * Deliberately independent of lead_score: if the scoring engine is down, this is
 * the only thing standing between a real lead and silence.
 */
const fallbackTask: JobHandler = async (payload, jobId) => {
  const { leadId, submissionId } = requireIds(payload);

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error(`lead ${leadId} not found`);

  await recordEvent(leadId, submissionId, 'fallback_task', 'success', jobId, {
    assignedTo: lead.assignedTo ?? 'marketing@queue',
    dueDate: new Date(Date.now() + 86_400_000).toISOString(),
    note: 'Review new lead',
  });

  logger.info({ leadId, email: lead.email }, 'fallback review task created');
};

// ---------------------------------------------------------------------------
// crm_push
// ---------------------------------------------------------------------------

const crmPush: JobHandler = async (payload, jobId) => {
  const { leadId, submissionId } = requireIds(payload);

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { scores: { orderBy: { id: 'desc' }, take: 8 } },
  });
  if (!lead) throw new Error(`lead ${leadId} not found`);

  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: { tracking: true },
  });
  if (!submission) throw new Error(`submission ${submissionId} not found`);

  // A flagged submission never reaches the CRM. Pushing spam wastes API quota and,
  // worse, pollutes the pipeline someone has to trust.
  if (submission.isSuspectedBot) {
    await recordEvent(leadId, submissionId, 'crm_push', 'skipped', jobId, {
      reason: 'suspected bot',
    });
    return;
  }

  // Non-sales inquiries are not deals. Support tickets and press enquiries in the
  // pipeline make the forecast meaningless.
  if (lead.routingTier?.startsWith('bypass_')) {
    await recordEvent(leadId, submissionId, 'crm_push', 'skipped', jobId, {
      reason: `not a sales lead (${lead.routingTier})`,
    });
    return;
  }

  const result = await pushToCrm({
    email: lead.email,
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phoneE164,
    companyName: lead.companyName,
    jobTitle: lead.jobTitle,
    companySize: lead.companySize,
    countryCode: lead.countryCode,
    leadScore: lead.leadScore,
    routingTier: lead.routingTier,
    frameworkInterest: lead.frameworkInterest,
    // The ledger, so a human sees why it scored what it did rather than a bare number.
    scoreBreakdown: lead.scores.map((s) => `+${s.points} — ${s.reason}`),
    formId: submission.formId,
    formName: submission.formName,
    message: submission.messageText,
    landingPage: submission.tracking?.landingPage ?? null,
    pageUrl: submission.tracking?.pageUrl ?? null,
    utmSource: submission.tracking?.utmSource ?? null,
    utmMedium: submission.tracking?.utmMedium ?? null,
    utmCampaign: submission.tracking?.utmCampaign ?? null,
    existingOdooId: lead.crmLeadId,
  });

  // Store the CRM id immediately. Without it a retry after a timeout creates a second
  // record and splits the lead's history.
  if (result.crmId) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { crmLeadId: result.crmId, crmSyncedAt: new Date() },
    });
  }

  await recordEvent(leadId, submissionId, 'crm_push', result.simulated ? 'skipped' : 'success', jobId, {
    crmId: result.crmId,
    created: result.created,
    simulated: result.simulated,
  });
};

// ---------------------------------------------------------------------------
// ai_extract — framework, urgency and team size from free text
// ---------------------------------------------------------------------------

/**
 * Keyword extraction, not an LLM call.
 *
 * Deliberate: the spec calls for an AI pass, but the useful signals here are
 * keyword-shaped, and a deterministic pass is free, instant and testable. The LLM
 * belongs here only once there is something genuinely semantic to extract —
 * swapping this function out later costs nothing.
 */
const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/\bsoc\s?-?2\b/i, 'soc2'],
  [/\biso\s?-?27001\b/i, 'iso27001'],
  [/\biso\s?-?42001\b/i, 'iso42001'],
  [/\bhipaa\b/i, 'hipaa'],
  [/\bgdpr\b/i, 'gdpr'],
  [/\bpci(\s|-)?dss\b/i, 'pci_dss'],
  [/\bnist\b/i, 'nist'],
  [/\bfedramp\b/i, 'fedramp'],
  [/\beu\s?ai\s?act\b/i, 'eu_ai_act'],
];

const URGENCY_PATTERNS =
  /\b(urgent|asap|immediately|deadline|audit\s+(is|in)|next\s+(week|month)|running\s+out|time.sensitive|expiring)\b/i;

const aiExtract: JobHandler = async (payload, jobId) => {
  const { leadId, submissionId } = requireIds(payload);

  const submission = await prisma.formSubmission.findUnique({ where: { id: submissionId } });
  if (!submission) throw new Error(`submission ${submissionId} not found`);

  if (!submission.messageText) {
    await recordEvent(leadId, submissionId, 'ai_extract', 'skipped', jobId, {
      reason: 'no message text',
    });
    return;
  }

  const text = submission.messageText;

  const frameworks = FRAMEWORK_PATTERNS.filter(([pattern]) => pattern.test(text)).map(
    ([, name]) => name,
  );
  const isUrgent = URGENCY_PATTERNS.test(text);

  // Merge with whatever the form already captured — never overwrite an explicit
  // selection with an inference.
  if (frameworks.length > 0) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    const existing = lead?.frameworkInterest?.split(',').filter(Boolean) ?? [];
    const merged = [...new Set([...existing, ...frameworks])];

    await prisma.lead.update({
      where: { id: leadId },
      data: { frameworkInterest: merged.join(',') },
    });
  }

  await recordEvent(leadId, submissionId, 'ai_extract', 'success', jobId, {
    frameworks,
    urgent: isUrgent,
    // What an SDR reads instead of the raw message.
    summary: `${frameworks.length ? `Mentions ${frameworks.join(', ')}. ` : ''}${
      isUrgent ? 'Urgency language detected.' : ''
    }`.trim(),
  });

  logger.debug({ leadId, frameworks, isUrgent }, 'message parsed');
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const HANDLERS: Record<JobType, JobHandler> = {
  enrich,
  confirmation_email: confirmationEmail,
  slack_alert: slackAlert,
  calendar_send: calendarSend,
  fallback_task: fallbackTask,
  crm_push: crmPush,
  ai_extract: aiExtract,
};
