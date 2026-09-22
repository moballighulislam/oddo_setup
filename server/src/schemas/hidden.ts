/**
 * The ~25 auto-captured hidden fields that ride along with every submission.
 *
 * These come from the client tracking snippet, not from the visitor. Two rules
 * follow from that:
 *
 *  1. Everything is optional. An ad-blocker, a privacy browser or a direct visit
 *     can strip any of it. A missing UTM parameter must never fail a submission —
 *     losing a real lead over absent analytics is a bad trade.
 *
 *  2. Everything is untrusted. The client can send anything, so strings are
 *     length-capped rather than rejected, and `ipAddress` / `userAgent` sent by
 *     the client are ignored in favour of server-derived values.
 */
import { z } from 'zod';
import { DEVICE_TYPES } from './enums.js';

/**
 * Truncate instead of reject. A 900-character referrer URL is real traffic worth
 * keeping, not a validation failure worth turning into a 400.
 */
const capped = (max: number) =>
  z
    .string()
    .trim()
    .transform((s) => (s.length > max ? s.slice(0, max) : s))
    .optional();

const cappedUrl = (max: number) => capped(max);

export const HiddenFieldsSchema = z.object({
  // --- UTM parameters, read from the URL and held in a 90-day cookie ---
  utm_source: capped(255),
  utm_medium: capped(255),
  utm_campaign: capped(255),
  utm_term: capped(255),
  utm_content: capped(255),

  // --- multi-touch attribution ---
  // first_touch_src is write-once client-side; last_touch_src is the converting source
  first_touch_src: capped(255),
  last_touch_src: capped(255),

  // --- page context ---
  page_url: cappedUrl(1000),
  referrer_url: cappedUrl(1000),
  landing_page: cappedUrl(1000),

  // --- session and behaviour; feeds the behavioural scoring dimension ---
  session_id: capped(128),
  pages_viewed: z.coerce.number().int().min(0).max(10_000).optional(),
  visit_count: z.coerce.number().int().min(0).max(10_000).optional(),
  time_on_site_sec: z.coerce.number().int().min(0).max(86_400).optional(),
  visited_pricing: z.coerce.boolean().optional(),

  // --- device ---
  device_type: z.enum(DEVICE_TYPES).optional(),

  // --- anti-bot signals, also client-supplied ---
  // Seconds between form render and submit. Under MIN_SUBMIT_SECONDS is a bot.
  form_render_ms: z.coerce.number().int().min(0).optional(),
  // Honeypot. A real browser leaves this empty; naive bots fill every input.
  website: z.string().max(200).optional(),
  // reCAPTCHA v3 token, verified server-side
  recaptcha_token: z.string().max(4000).optional(),
});

export type HiddenFields = z.infer<typeof HiddenFieldsSchema>;

/**
 * Fields the client must never be allowed to set, even if it sends them.
 * Scores and routing are server-owned; accepting them from a POST body would let
 * anyone hand themselves a score of 100 and an enterprise AE.
 */
export const SERVER_OWNED_FIELDS = [
  'lead_score',
  'leadScore',
  'lead_status',
  'leadStatus',
  'assigned_to',
  'assignedTo',
  'routing_tier',
  'routingTier',
  'sla_due_at',
  'slaDueAt',
  'id',
  'public_id',
  'publicId',
  'lead_id',
  'leadId',
  'ip_address',
  'ipAddress',
  'geo_country',
  'geo_region',
  'geo_city',
] as const;

/** Strip server-owned keys from an arbitrary client payload. */
export function stripServerOwned<T extends Record<string, unknown>>(
  payload: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const blocked = new Set<string>(SERVER_OWNED_FIELDS);
  for (const [k, v] of Object.entries(payload)) {
    if (!blocked.has(k)) out[k] = v;
  }
  return out;
}
