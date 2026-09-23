/**
 * Single source of truth for every enumerated value in the system.
 *
 * The Prisma schema stores these as plain String columns because SQLite has no
 * native enum type. That means the database will NOT reject a bad value — these
 * Zod enums are the enforcement layer, and every write path must go through them.
 *
 * When the database moves to MySQL these become native enums and the DB becomes
 * a second line of defence. Until then, this file is the only one.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * The four form TEMPLATES. Drives scoring, automation triggers and validation.
 * This list is closed — a new placement is a new formName, not a new formId.
 */
export const FORM_IDS = ['quick_capture', 'footer_form', 'demo_form', 'contact_form'] as const;
export const FormIdSchema = z.enum(FORM_IDS);
export type FormId = z.infer<typeof FormIdSchema>;

/**
 * Where a template was placed. Open-ended by design: adding a placement must not
 * require a migration. Reporting groups on this; logic never branches on it.
 */
export const KNOWN_FORM_NAMES = [
  'homepage_popup',
  'solutions_banner',
  'site_footer',
  'book_a_demo',
  'contact_us',
  'exit_intent',
] as const;

/** contact_form only. Bypasses scoring entirely and routes straight to a team. */
export const INQUIRY_TYPES = [
  'request_demo',
  'general',
  'partnership',
  'support',
  'media',
] as const;
export const InquiryTypeSchema = z.enum(INQUIRY_TYPES);
export type InquiryType = z.infer<typeof InquiryTypeSchema>;

// ---------------------------------------------------------------------------
// Firmographics
// ---------------------------------------------------------------------------

/** Feeds the firmographic scoring dimension directly. */
export const COMPANY_SIZES = ['1-50', '51-200', '201-1000', '1000+'] as const;
export const CompanySizeSchema = z.enum(COMPANY_SIZES);
export type CompanySize = z.infer<typeof CompanySizeSchema>;

/**
 * GRC frameworks a buyer can be evaluating. Drives Layer 2 nurture branching —
 * a lead who arrived via the SOC 2 checklist enters the SOC 2 track.
 */
export const FRAMEWORKS = [
  'soc2',
  'iso27001',
  'hipaa',
  'gdpr',
  'pci_dss',
  'nist',
  'fedramp',
  'iso42001',
  'eu_ai_act',
  'other',
] as const;
export const FrameworkSchema = z.enum(FRAMEWORKS);
export type Framework = z.infer<typeof FrameworkSchema>;

/**
 * Product areas a buyer can be interested in.
 *
 * This changes the demo itself, so the rep needs it before the call rather than
 * discovering it in the first five minutes.
 */
export const SOLUTIONS = [
  'risk_management',
  'ai_governance',
  'compliance_automation',
  'not_sure',
] as const;
export const SolutionSchema = z.enum(SOLUTIONS);
export type Solution = z.infer<typeof SolutionSchema>;

/**
 * Country, as an ISO 3166-1 alpha-2 code.
 *
 * Not an enum: a 249-entry list would be noise here, and the frontend renders the
 * dropdown anyway. Two uppercase letters is the whole contract.
 *
 * Worth asking explicitly rather than deriving from the IP — GRC is
 * jurisdiction-specific (GDPR and the EU AI Act versus SOC 2 versus DPDP), and
 * IP-derived country is wrong often enough to matter. A corporate VPN routinely
 * reports the wrong country.
 */
export const CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'must be a two-letter ISO country code')
  .regex(/^[A-Z]{2}$/, 'must be a two-letter ISO country code');

/**
 * Coarse region, derived from the country code.
 *
 * Useful because the frameworks that matter are regional: EU buyers care about GDPR
 * and the EU AI Act, US buyers about SOC 2, and so on.
 */
export const REGIONS = ['eu', 'uk', 'us', 'apac', 'mea', 'latam', 'other'] as const;
export type Region = (typeof REGIONS)[number];

const EU_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV',
  'LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
]);
const APAC = new Set(['IN','SG','AU','NZ','JP','KR','CN','HK','MY','ID','TH','PH','VN','TW','BD','PK','LK']);
const MEA = new Set(['AE','SA','QA','KW','BH','OM','IL','ZA','NG','KE','EG','TR','MA','GH']);
const LATAM = new Set(['BR','MX','AR','CL','CO','PE','UY','EC','CR','PA']);

export function regionForCountry(code: string | null | undefined): Region | null {
  if (!code) return null;
  const c = code.toUpperCase();
  if (EU_COUNTRIES.has(c)) return 'eu';
  if (c === 'GB') return 'uk';
  if (c === 'US' || c === 'CA') return 'us';
  if (APAC.has(c)) return 'apac';
  if (MEA.has(c)) return 'mea';
  if (LATAM.has(c)) return 'latam';
  return 'other';
}

// ---------------------------------------------------------------------------
// Lead lifecycle
// ---------------------------------------------------------------------------

export const LEAD_STATUSES = ['new', 'working', 'nurture', 'qualified', 'disqualified'] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

/**
 * Routing outcome. The first four are score-driven tiers; the bypass_* values are
 * for contact_form inquiry types that skip scoring altogether.
 */
export const ROUTING_TIERS = [
  'enterprise_ae', // score 80-100, 1h SLA, instant Slack alert
  'sdr', // score 50-79, 4h SLA
  'nurture', // score 30-49, automated 6-email drip
  'marketing_drip', // score 0-29, monthly newsletter only
  'bypass_support',
  'bypass_partnership',
  'bypass_media',
] as const;
export const RoutingTierSchema = z.enum(ROUTING_TIERS);
export type RoutingTier = z.infer<typeof RoutingTierSchema>;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The four scoring dimensions. Their caps sum to exactly 100. */
export const SCORE_CATEGORIES = ['form_intent', 'firmographic', 'job_title', 'behavioral'] as const;
export const ScoreCategorySchema = z.enum(SCORE_CATEGORIES);
export type ScoreCategory = z.infer<typeof ScoreCategorySchema>;

export const SCORE_CAPS: Record<ScoreCategory, number> = {
  form_intent: 30,
  firmographic: 25,
  job_title: 25,
  behavioral: 20,
};

// ---------------------------------------------------------------------------
// Newsletter
// ---------------------------------------------------------------------------

export const SUBSCRIBER_STATUSES = [
  'subscribed',
  'unsubscribed',
  'bounced',
  'complained',
] as const;
export const SubscriberStatusSchema = z.enum(SUBSCRIBER_STATUSES);
export type SubscriberStatus = z.infer<typeof SubscriberStatusSchema>;

// ---------------------------------------------------------------------------
// Automation audit trail
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'confirmation_email',
  'slack_alert',
  'calendar_send',
  'crm_push',
  'ai_extract',
  'score_computed',
  'routed',
  'fallback_task',
  'sequence_enrolled',
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EVENT_STATUSES = ['pending', 'success', 'failed', 'skipped'] as const;
export const EventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof EventStatusSchema>;

// ---------------------------------------------------------------------------
// Anti-bot
// ---------------------------------------------------------------------------

/** Why a submission was flagged. Stored, never used to silently drop a record. */
export const BOT_REASONS = ['honeypot', 'too_fast', 'low_score', 'rate_limited'] as const;
export const BotReasonSchema = z.enum(BOT_REASONS);
export type BotReason = z.infer<typeof BotReasonSchema>;

export const DEVICE_TYPES = ['desktop', 'mobile', 'tablet'] as const;
export const DeviceTypeSchema = z.enum(DEVICE_TYPES);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;
