/**
 * Odoo CRM client.
 *
 * Speaks Odoo's JSON-RPC endpoint (`/jsonrpc`) rather than XML-RPC, so this needs no
 * dependency — plain `fetch` and JSON. Same `execute_kw` surface underneath.
 *
 * Two things about Odoo's RPC that shape this file:
 *
 *  1. **Errors arrive with HTTP 200.** A failed call returns a normal 200 response
 *     whose body contains an `error` key. Checking `res.ok` is not enough; every
 *     response body must be inspected or failures pass silently.
 *
 *  2. **Relational fields need ids, not names.** A UTM source, a tag or a country is
 *     a foreign key. Writing "google" as a string fails — it has to be looked up or
 *     created first, which is what the findOrCreate helpers below do.
 */
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface RpcResponse<T> {
  result?: T;
  error?: {
    message?: string;
    data?: { message?: string; name?: string };
  };
}

/** Cached session. Re-authenticating on every call would triple the round trips. */
let cachedUid: number | null = null;
let cachedAt = 0;
const UID_TTL_MS = 30 * 60 * 1000;

export function isOdooConfigured(): boolean {
  return Boolean(env.ODOO_URL && env.ODOO_DB && env.ODOO_USERNAME && env.ODOO_API_KEY);
}

async function rpc<T>(service: string, method: string, args: unknown[]): Promise<T> {
  const url = `${env.ODOO_URL.replace(/\/$/, '')}/jsonrpc`;

  // Hard timeout. This runs in a worker, but a hung request still holds a slot.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: Date.now(),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Odoo returned HTTP ${res.status}`);
    }

    const body = (await res.json()) as RpcResponse<T>;

    // Odoo reports application errors inside a 200 response.
    if (body.error) {
      const detail = body.error.data?.message ?? body.error.message ?? 'unknown error';
      const name = body.error.data?.name ?? '';
      throw new Error(`Odoo error${name ? ` (${name})` : ''}: ${detail}`);
    }

    return body.result as T;
  } finally {
    clearTimeout(timeout);
  }
}

/** Log in and cache the uid. */
async function uid(): Promise<number> {
  if (cachedUid !== null && Date.now() - cachedAt < UID_TTL_MS) return cachedUid;

  const result = await rpc<number | false>('common', 'login', [
    env.ODOO_DB,
    env.ODOO_USERNAME,
    env.ODOO_API_KEY,
  ]);

  // Odoo returns `false` for bad credentials rather than raising.
  if (!result) {
    throw new Error(
      'Odoo authentication failed — check ODOO_DB, ODOO_USERNAME and ODOO_API_KEY. ' +
        'The database name is often not the same as the subdomain.',
    );
  }

  cachedUid = result;
  cachedAt = Date.now();
  return result;
}

/** Call a method on an Odoo model. */
export async function execute<T>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  const userId = await uid();
  return rpc<T>('object', 'execute_kw', [
    env.ODOO_DB,
    userId,
    env.ODOO_API_KEY,
    model,
    method,
    args,
    kwargs,
  ]);
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Process-lifetime cache for id lookups.
 *
 * UTM sources, tags and countries are effectively immutable once created, and the
 * same handful repeat across every lead. Without this, one submission costs a dozen
 * extra round trips.
 */
const idCache = new Map<string, number>();

/**
 * Find a record by name, creating it if absent.
 *
 * Used for the UTM models and tags, where Odoo expects a foreign key but the form
 * gives us a string.
 */
async function findOrCreateByName(model: string, name: string): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const key = `${model}:${trimmed.toLowerCase()}`;
  const cached = idCache.get(key);
  if (cached !== undefined) return cached;

  const found = await execute<number[]>(model, 'search', [[['name', '=', trimmed]]], {
    limit: 1,
  });

  let id: number;
  if (found.length > 0) {
    id = found[0]!;
  } else {
    id = await execute<number>(model, 'create', [{ name: trimmed }]);
    logger.debug({ model, name: trimmed, id }, 'created Odoo record');
  }

  idCache.set(key, id);
  return id;
}

/** Resolve a two-letter country code to an Odoo country id. */
async function countryId(code: string | null): Promise<number | null> {
  if (!code) return null;

  const key = `res.country:${code}`;
  const cached = idCache.get(key);
  if (cached !== undefined) return cached;

  const found = await execute<number[]>('res.country', 'search', [[['code', '=', code.toUpperCase()]]], {
    limit: 1,
  });
  if (found.length === 0) return null;

  idCache.set(key, found[0]!);
  return found[0]!;
}

/** Resolve the configured sales team. Null means Odoo picks its own default. */
async function salesTeamId(): Promise<number | null> {
  if (!env.ODOO_SALES_TEAM) return null;

  const key = `crm.team:${env.ODOO_SALES_TEAM}`;
  const cached = idCache.get(key);
  if (cached !== undefined) return cached;

  const found = await execute<number[]>('crm.team', 'search', [[['name', '=', env.ODOO_SALES_TEAM]]], {
    limit: 1,
  });

  if (found.length === 0) {
    // Not fatal — the lead still lands, just on Odoo's default team.
    logger.warn(
      { team: env.ODOO_SALES_TEAM },
      'ODOO_SALES_TEAM not found in Odoo — lead will use the default team',
    );
    return null;
  }

  idCache.set(key, found[0]!);
  return found[0]!;
}

// ---------------------------------------------------------------------------
// Lead push
// ---------------------------------------------------------------------------

export interface OdooLeadInput {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  companySize: string | null;
  countryCode: string | null;
  leadScore: number;
  routingTier: string | null;
  frameworkInterest: string | null;
  /** Readable score breakdown, so a human sees why it scored what it did. */
  scoreBreakdown: string[];
  formId: string;
  formName: string;
  message: string | null;
  landingPage: string | null;
  pageUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** Set when we have pushed this lead before — then we update instead of create. */
  existingOdooId: number | null;
}

export interface OdooPushResult {
  odooId: number;
  created: boolean;
  type: 'lead' | 'opportunity';
}

/**
 * Odoo priority is a 0–3 selection rendered as stars.
 *
 * With one person selling there are no assignment rules — priority is what tells you
 * which record to open first, so it carries the whole routing decision.
 */
function priorityFromScore(score: number): string {
  if (score >= 80) return '3';
  if (score >= 50) return '2';
  if (score >= 30) return '1';
  return '0';
}

/**
 * Sales tiers become Opportunities and enter the pipeline. Everything else becomes a
 * Lead and stays out of it.
 *
 * Without this split the pipeline fills with newsletter subscribers and stops being a
 * forecast — a post bringing 200 visitors might yield 10 signups and 1 demo request,
 * and the one that matters must not be buried.
 */
function typeForTier(tier: string | null): 'lead' | 'opportunity' {
  return tier === 'enterprise_ae' || tier === 'sdr' ? 'opportunity' : 'lead';
}

/** Human-readable title, since Odoo shows this everywhere. */
function buildName(input: OdooLeadInput): string {
  const company = input.companyName?.trim();
  const person = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
  const label = FORM_LABELS[input.formId] ?? 'Website enquiry';
  return `${company || person || input.email} — ${label}`;
}

const FORM_LABELS: Record<string, string> = {
  demo_form: 'Demo request',
  contact_form: 'Contact enquiry',
  quick_capture: 'Website enquiry',
  footer_form: 'Newsletter signup',
};

/** Odoo's `description` is an HTML field. */
function buildDescription(input: OdooLeadInput): string {
  const lines: string[] = [];

  lines.push(`<p><b>Lead score: ${input.leadScore}/100</b> (${input.routingTier ?? 'unscored'})</p>`);

  if (input.scoreBreakdown.length > 0) {
    lines.push('<ul>');
    for (const reason of input.scoreBreakdown) lines.push(`<li>${escapeHtml(reason)}</li>`);
    lines.push('</ul>');
  }

  if (input.message) {
    lines.push(`<p><b>Their message:</b></p><p>${escapeHtml(input.message)}</p>`);
  }

  const context: string[] = [];
  if (input.companySize) context.push(`Company size: ${input.companySize}`);
  if (input.frameworkInterest) context.push(`Frameworks: ${input.frameworkInterest}`);
  if (input.landingPage) context.push(`Landed on: ${input.landingPage}`);
  if (input.pageUrl) context.push(`Submitted from: ${input.pageUrl}`);
  context.push(`Form: ${input.formName}`);

  lines.push(`<p>${context.map(escapeHtml).join('<br/>')}</p>`);

  return lines.join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Create or update a lead in Odoo.
 *
 * Deduplication is three-layered, because a duplicated lead is worse than a missing
 * one — it splits history across two records:
 *   1. `existingOdooId` from our own database, when we've pushed before
 *   2. otherwise search Odoo by email
 *   3. only then create
 */
export async function pushLead(input: OdooLeadInput): Promise<OdooPushResult> {
  const type = typeForTier(input.routingTier);

  // --- Resolve every relational field first ---
  const [teamId, country, sourceId, mediumId, campaignId] = await Promise.all([
    salesTeamId(),
    countryId(input.countryCode),
    input.utmSource ? findOrCreateByName('utm.source', input.utmSource) : null,
    input.utmMedium ? findOrCreateByName('utm.medium', input.utmMedium) : null,
    input.utmCampaign ? findOrCreateByName('utm.campaign', input.utmCampaign) : null,
  ]);

  // Tags: routing tier plus each framework, so "everyone who mentioned SOC 2" is a
  // one-click filter.
  const tagNames = [
    input.routingTier,
    ...(input.frameworkInterest?.split(',').filter(Boolean) ?? []),
  ].filter((t): t is string => Boolean(t));

  const tagIds: number[] = [];
  for (const name of tagNames) {
    const id = await findOrCreateByName('crm.tag', name);
    if (id !== null) tagIds.push(id);
  }

  const values: Record<string, unknown> = {
    name: buildName(input),
    type,
    contact_name: [input.firstName, input.lastName].filter(Boolean).join(' ') || null,
    email_from: input.email,
    phone: input.phone,
    partner_name: input.companyName,
    function: input.jobTitle,
    priority: priorityFromScore(input.leadScore),
    description: buildDescription(input),
  };

  if (teamId) values.team_id = teamId;
  if (country) values.country_id = country;
  if (sourceId) values.source_id = sourceId;
  if (mediumId) values.medium_id = mediumId;
  if (campaignId) values.campaign_id = campaignId;
  // (6, 0, ids) is Odoo's "replace the whole set" command for many2many fields.
  if (tagIds.length > 0) values.tag_ids = [[6, 0, tagIds]];

  // --- 1. Known record ---
  if (input.existingOdooId) {
    const exists = await execute<number[]>('crm.lead', 'search', [
      [['id', '=', input.existingOdooId]],
    ]);

    if (exists.length > 0) {
      await updateExisting(input.existingOdooId, values, input);
      return { odooId: input.existingOdooId, created: false, type };
    }
    // Deleted in Odoo since we last pushed — fall through and recreate.
    logger.warn({ odooId: input.existingOdooId }, 'Odoo record gone — recreating');
  }

  // --- 2. Search by email ---
  const found = await execute<number[]>(
    'crm.lead',
    'search',
    [
      [
        ['email_from', '=ilike', input.email],
        // Odoo soft-deletes won/lost records out of the default view; include them so
        // a closed-lost lead who returns is recognised rather than duplicated.
        '|',
        ['active', '=', true],
        ['active', '=', false],
      ],
    ],
    { limit: 1, order: 'id desc' },
  );

  if (found.length > 0) {
    await updateExisting(found[0]!, values, input);
    return { odooId: found[0]!, created: false, type };
  }

  // --- 3. Create ---
  const odooId = await execute<number>('crm.lead', 'create', [values]);
  logger.info({ odooId, type, score: input.leadScore }, 'created Odoo lead');

  return { odooId, created: true, type };
}

/**
 * Update an existing record.
 *
 * Deliberately conservative. A returning lead must not overwrite work a human has
 * done: the stage they moved it to, the salesperson they assigned, or notes they
 * wrote. Only the new information is written, and the submission is logged as a
 * message rather than replacing the description.
 */
async function updateExisting(
  odooId: number,
  values: Record<string, unknown>,
  input: OdooLeadInput,
): Promise<void> {
  const safe: Record<string, unknown> = {
    priority: values.priority,
    // Fill blanks without clobbering anything a human corrected.
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.companyName ? { partner_name: input.companyName } : {}),
    ...(input.jobTitle ? { function: input.jobTitle } : {}),
    ...(values.tag_ids ? { tag_ids: values.tag_ids } : {}),
  };

  // Promote a Lead to an Opportunity if they now qualify — but never demote. Someone
  // who booked a demo is in the pipeline to stay, even if a later newsletter signup
  // scores lower.
  if (values.type === 'opportunity') safe.type = 'opportunity';

  await execute('crm.lead', 'write', [[odooId], safe]);

  // Log the new submission as a chatter message so the history is visible and the
  // original description is preserved.
  await execute('crm.lead', 'message_post', [[odooId]], {
    body:
      `<p><b>New submission: ${escapeHtml(FORM_LABELS[input.formId] ?? input.formId)}</b> ` +
      `— score now ${input.leadScore}/100</p>${buildDescription(input)}`,
  });

  logger.info({ odooId, score: input.leadScore }, 'updated Odoo lead');
}

/** Connectivity check, for diagnostics and the health endpoint. */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  if (!isOdooConfigured()) {
    return { ok: false, detail: 'not configured' };
  }
  try {
    const userId = await uid();
    const version = await rpc<{ server_version?: string }>('common', 'version', []);
    return {
      ok: true,
      detail: `connected as uid ${userId}, Odoo ${version?.server_version ?? 'unknown'}`,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Drop cached ids and session. Used by tests. */
export function resetOdooCache(): void {
  idCache.clear();
  cachedUid = null;
  cachedAt = 0;
}
