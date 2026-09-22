/**
 * Outbound integrations: email, Slack, CRM.
 *
 * Each provider is an interface with a logging implementation that runs when no
 * credential is configured. That means the whole automation pipeline is testable
 * and observable today, before any vendor is chosen — the jobs run, the audit trail
 * fills in, and the only difference is that nothing leaves the building.
 *
 * Swapping in a real vendor means writing one function. No caller changes.
 */
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { isOdooConfigured, pushLead, type OdooLeadInput } from './odoo.js';

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  /** Appended as a footer link. Required on anything marketing. */
  unsubscribeUrl?: string;
}

export interface EmailResult {
  sent: boolean;
  providerId: string | null;
  /** True when it was logged rather than sent, so the audit trail can say so. */
  simulated: boolean;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (!env.EMAIL_PROVIDER_API_KEY) {
    logger.info(
      { to: message.to, subject: message.subject },
      '[simulated email] would send — EMAIL_PROVIDER_API_KEY not configured',
    );
    return { sent: false, providerId: null, simulated: true };
  }

  // TODO(email): wire SendGrid/Postmark here once a provider is chosen.
  // Throwing rather than silently dropping: a configured key that cannot send is a
  // real failure and the retry machinery should see it.
  throw new Error('EMAIL_PROVIDER_API_KEY is set but no provider implementation exists yet');
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export interface SlackAlert {
  text: string;
  fields: Record<string, string>;
}

export async function sendSlackAlert(alert: SlackAlert): Promise<{ sent: boolean; simulated: boolean }> {
  if (!env.SLACK_WEBHOOK_URL) {
    logger.info({ alert: alert.text }, '[simulated slack] would post — SLACK_WEBHOOK_URL not configured');
    return { sent: false, simulated: true };
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${alert.text}*` } },
    {
      type: 'section',
      fields: Object.entries(alert.fields).map(([k, v]) => ({
        type: 'mrkdwn',
        text: `*${k}*\n${v}`,
      })),
    },
  ];

  // Hard timeout: a hanging webhook must not hold a worker slot open.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: alert.text, blocks }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}`);
    }

    return { sent: true, simulated: false };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

/** Everything the CRM push needs. Assembled by the crm_push handler. */
export type CrmLead = OdooLeadInput;

export interface CrmResult {
  pushed: boolean;
  crmId: number | null;
  created: boolean;
  simulated: boolean;
}

/**
 * Push a lead to the CRM.
 *
 * Odoo is the implementation; the seam is kept so swapping vendors touches only this
 * function. Nothing upstream knows anything about a CRM beyond "push this lead".
 *
 * Throws on failure rather than swallowing it — `crm_push` carries the highest retry
 * budget in the system (8 attempts) because a lead that never reaches the CRM is
 * invisible to sales, which is the worst outcome this system can produce.
 */
export async function pushToCrm(lead: CrmLead): Promise<CrmResult> {
  if (!isOdooConfigured()) {
    logger.info(
      { email: lead.email, score: lead.leadScore, tier: lead.routingTier },
      '[simulated crm] would push to Odoo — credentials not configured',
    );
    return { pushed: false, crmId: null, created: false, simulated: true };
  }

  const result = await pushLead(lead);

  return {
    pushed: true,
    crmId: result.odooId,
    created: result.created,
    simulated: false,
  };
}

// ---------------------------------------------------------------------------
// Unsubscribe links
// ---------------------------------------------------------------------------

export function unsubscribeUrl(token: string): string {
  return `${env.PUBLIC_API_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}
