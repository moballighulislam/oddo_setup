/**
 * Sales routing — pure functions, no I/O.
 *
 * Decides who owns a lead and by when. Two paths:
 *
 *   1. Bypass. A contact_form with inquiry_type support / partnership / media is
 *      not a sales lead at all and skips scoring entirely. Scoring a support
 *      ticket and handing it to an AE wastes both teams' time.
 *
 *   2. Score tiers. Everything else routes on the composite 0-100 score.
 */
import type { FormId, InquiryType, RoutingTier } from '../schemas/enums.js';

export interface RoutingDecision {
  tier: RoutingTier;
  /** Team or queue that owns the lead. Resolved to a person by the CRM. */
  assignedTo: string;
  /** Minutes until the SLA expires. null means no human SLA (automated only). */
  slaMinutes: number | null;
  /** Whether a Slack alert fires. Scoped narrowly on purpose — alert fatigue kills response times. */
  notifySlack: boolean;
  /** Whether the lead enters the 21-day automated cadence. */
  enrolInSequence: boolean;
  reason: string;
}

/** Queue identifiers. The CRM maps these to real people. */
const QUEUES = {
  enterpriseAe: 'enterprise-ae@queue',
  sdr: 'sdr@queue',
  marketing: 'marketing@queue',
  support: 'support@queue',
  partnerships: 'bd@queue',
  press: 'press@queue',
} as const;

/**
 * inquiry_type values that never reach the sales pipeline.
 * request_demo and general are absent deliberately — those ARE sales leads.
 */
const BYPASS_ROUTES: Partial<Record<InquiryType, RoutingDecision>> = {
  support: {
    tier: 'bypass_support',
    assignedTo: QUEUES.support,
    slaMinutes: 240,
    notifySlack: false,
    enrolInSequence: false,
    reason: 'Support inquiry — routed to support inbox as a ticket',
  },
  partnership: {
    tier: 'bypass_partnership',
    assignedTo: QUEUES.partnerships,
    slaMinutes: 1440,
    notifySlack: false,
    enrolInSequence: false,
    reason: 'Partnership inquiry — routed to BD',
  },
  media: {
    tier: 'bypass_media',
    assignedTo: QUEUES.press,
    slaMinutes: null,
    notifySlack: false,
    enrolInSequence: false,
    reason: 'Media inquiry — auto-reply with press kit',
  },
};

export interface RoutingFacts {
  score: number;
  formId: FormId;
  inquiryType?: string | undefined;
  isSuspectedBot?: boolean | undefined;
}

/**
 * Route a lead.
 *
 * Order matters: bot check, then bypass, then score tiers. A flagged submission
 * must never page a rep, whatever it scored.
 */
export function route(facts: RoutingFacts): RoutingDecision {
  // Suspected bots are stored and visible, but never assigned or alerted on.
  if (facts.isSuspectedBot) {
    return {
      tier: 'marketing_drip',
      assignedTo: QUEUES.marketing,
      slaMinutes: null,
      notifySlack: false,
      enrolInSequence: false,
      reason: 'Flagged as suspected bot — held for manual review, no outreach',
    };
  }

  // Non-sales inquiries skip scoring entirely.
  if (facts.inquiryType) {
    const bypass = BYPASS_ROUTES[facts.inquiryType as InquiryType];
    if (bypass) return bypass;
  }

  // Score tiers.
  if (facts.score >= 80) {
    return {
      tier: 'enterprise_ae',
      assignedTo: QUEUES.enterpriseAe,
      slaMinutes: 60,
      notifySlack: true,
      // Not enrolled: a rep is calling within the hour. Running a drip alongside
      // that means the prospect gets an automated email and a human call the same
      // morning, which reads as disorganised.
      enrolInSequence: false,
      reason: `Score ${facts.score} — enterprise AE, 1 hour SLA`,
    };
  }

  if (facts.score >= 50) {
    return {
      tier: 'sdr',
      assignedTo: QUEUES.sdr,
      slaMinutes: 240,
      // Demo requests page the team; a mid-score quick capture does not.
      notifySlack: facts.formId === 'demo_form',
      enrolInSequence: true,
      reason: `Score ${facts.score} — SDR follow-up, 4 hour SLA`,
    };
  }

  if (facts.score >= 30) {
    return {
      tier: 'nurture',
      assignedTo: QUEUES.marketing,
      slaMinutes: null,
      notifySlack: false,
      enrolInSequence: true,
      reason: `Score ${facts.score} — automated nurture sequence, re-scored on engagement`,
    };
  }

  return {
    tier: 'marketing_drip',
    assignedTo: QUEUES.marketing,
    slaMinutes: null,
    notifySlack: false,
    enrolInSequence: false,
    reason: `Score ${facts.score} — monthly newsletter only`,
  };
}

/** Absolute SLA deadline, or null when the tier carries no human SLA. */
export function slaDeadline(decision: RoutingDecision, from: Date = new Date()): Date | null {
  if (decision.slaMinutes === null) return null;
  return new Date(from.getTime() + decision.slaMinutes * 60_000);
}

/**
 * Lead status implied by a routing decision. Keeps `lead_status` and `routing_tier`
 * from drifting apart, which they will if each is set by hand at its own call site.
 */
export function statusForTier(tier: RoutingTier): string {
  switch (tier) {
    case 'enterprise_ae':
    case 'sdr':
      return 'working';
    case 'nurture':
    case 'marketing_drip':
      return 'nurture';
    case 'bypass_support':
    case 'bypass_partnership':
    case 'bypass_media':
      return 'disqualified'; // not a sales lead; excluded from pipeline reporting
    default:
      return 'new';
  }
}
