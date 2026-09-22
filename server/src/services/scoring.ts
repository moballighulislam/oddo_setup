/**
 * Lead scoring — pure functions, no I/O.
 *
 * Composite 0-100 across four dimensions whose caps sum to exactly 100:
 *   form_intent 30 | firmographic 25 | job_title 25 | behavioral 20
 *
 * Returns ledger ROWS rather than a single number. `lead_scores` is append-only so
 * every point stays explainable: "why is this lead an 85" is answered by listing
 * its rows, not by re-running the calculation and hoping it still matches.
 *
 * Kept free of database calls so it can be unit-tested directly.
 */
import { SCORE_CAPS, type FormId, type ScoreCategory } from '../schemas/enums.js';

export interface ScoreEntry {
  category: ScoreCategory;
  points: number;
  reason: string;
}

export interface ScoringFacts {
  formId: FormId;
  companySize?: string | undefined;
  jobTitle?: string | undefined;
  visitedPricing?: boolean | undefined;
  visitCount?: number | undefined;
  pagesViewed?: number | undefined;
}

// ---------------------------------------------------------------------------
// form_intent — cap 30
// Which form they chose is the single strongest intent signal available at submit.
// ---------------------------------------------------------------------------
const FORM_INTENT_POINTS: Record<FormId, number> = {
  demo_form: 30,
  contact_form: 20,
  quick_capture: 15,
  footer_form: 5,
};

function scoreFormIntent(formId: FormId): ScoreEntry {
  return {
    category: 'form_intent',
    points: FORM_INTENT_POINTS[formId],
    reason: `Submitted ${formId.replace(/_/g, ' ')}`,
  };
}

// ---------------------------------------------------------------------------
// firmographic — cap 25
// Company size is the proxy for deal size and compliance burden. Larger orgs carry
// more frameworks and more audit pressure, so they convert on GRC tooling harder.
// ---------------------------------------------------------------------------
const COMPANY_SIZE_POINTS: Record<string, number> = {
  '1000+': 25,
  '201-1000': 18,
  '51-200': 10,
  '1-50': 3,
};

function scoreFirmographic(companySize?: string): ScoreEntry | null {
  if (!companySize) return null;
  const points = COMPANY_SIZE_POINTS[companySize];
  if (points === undefined) return null;
  return {
    category: 'firmographic',
    points,
    reason: `Company size: ${companySize}`,
  };
}

// ---------------------------------------------------------------------------
// job_title — cap 25
// Matched on normalised free text, most senior pattern first. A "VP of Risk and
// Compliance" must score as a VP, not fall through to the generic bucket.
// ---------------------------------------------------------------------------
interface TitleRule {
  pattern: RegExp;
  points: number;
  label: string;
}

const TITLE_RULES: TitleRule[] = [
  // Direct economic buyers for a GRC platform
  { pattern: /\b(ciso|chief information security)\b/, points: 25, label: 'CISO' },
  { pattern: /\b(cro|chief risk)\b/, points: 25, label: 'Chief Risk Officer' },
  { pattern: /\b(cco|chief compliance)\b/, points: 25, label: 'Chief Compliance Officer' },
  { pattern: /\bvp\b.*\b(risk|compliance|security|grc|audit)\b/, points: 25, label: 'VP Risk/Compliance' },
  { pattern: /\b(head of)\b.*\b(risk|compliance|security|grc|audit)\b/, points: 22, label: 'Head of Risk/Compliance' },

  // Other C-level: budget authority, less direct ownership
  { pattern: /\b(ceo|cto|cfo|coo|chief)\b/, points: 20, label: 'C-level executive' },

  // Practitioners: often the evaluator, rarely the signer
  { pattern: /\b(director)\b.*\b(risk|compliance|security|grc|audit|it)\b/, points: 18, label: 'Director' },
  { pattern: /\b(manager|lead)\b.*\b(risk|compliance|security|grc|audit)\b/, points: 12, label: 'Compliance manager' },
  { pattern: /\b(analyst|auditor|consultant)\b/, points: 8, label: 'Analyst / auditor' },
  { pattern: /\b(engineer|developer|architect)\b/, points: 6, label: 'Technical IC' },

  // Explicit negative signal: not a buyer, and a common source of junk submissions
  { pattern: /\b(student|intern|professor|teacher|researcher)\b/, points: 0, label: 'Non-buyer role' },
];

function scoreJobTitle(jobTitle?: string): ScoreEntry | null {
  if (!jobTitle) return null;
  const normalised = jobTitle.toLowerCase().trim();

  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(normalised)) {
      return {
        category: 'job_title',
        points: rule.points,
        reason: `Job title: ${rule.label}`,
      };
    }
  }

  // Title supplied but unrecognised. Still worth more than no title at all —
  // someone who filled the field is more engaged than someone who skipped it.
  return { category: 'job_title', points: 5, reason: 'Job title: other / unknown' };
}

// ---------------------------------------------------------------------------
// behavioral — cap 20
// What they did before submitting. Several signals can stack, capped at 20.
// ---------------------------------------------------------------------------
function scoreBehavioral(facts: ScoringFacts): ScoreEntry[] {
  const entries: ScoreEntry[] = [];

  if (facts.visitedPricing) {
    entries.push({
      category: 'behavioral',
      points: 10,
      reason: 'Visited pricing page',
    });
  }

  if ((facts.visitCount ?? 0) > 1) {
    entries.push({
      category: 'behavioral',
      points: 7,
      reason: `Return visitor (visit ${facts.visitCount})`,
    });
  }

  if ((facts.pagesViewed ?? 0) >= 5) {
    entries.push({
      category: 'behavioral',
      points: 5,
      reason: `Deep session (${facts.pagesViewed} pages viewed)`,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute ledger entries for a submission.
 * Each category is independently capped, so no single dimension can dominate even
 * if its rules are later expanded.
 */
export function computeScore(facts: ScoringFacts): ScoreEntry[] {
  const raw: ScoreEntry[] = [];

  raw.push(scoreFormIntent(facts.formId));

  const firmographic = scoreFirmographic(facts.companySize);
  if (firmographic) raw.push(firmographic);

  const title = scoreJobTitle(facts.jobTitle);
  if (title) raw.push(title);

  raw.push(...scoreBehavioral(facts));

  return capByCategory(raw);
}

/** Trim entries so each category's total never exceeds its cap. */
function capByCategory(entries: ScoreEntry[]): ScoreEntry[] {
  const running: Partial<Record<ScoreCategory, number>> = {};
  const out: ScoreEntry[] = [];

  for (const entry of entries) {
    const cap = SCORE_CAPS[entry.category];
    const used = running[entry.category] ?? 0;
    const remaining = cap - used;

    if (remaining <= 0) continue;

    const points = Math.min(entry.points, remaining);
    running[entry.category] = used + points;
    out.push({ ...entry, points });
  }

  return out;
}

/** Sum of a ledger. This is what gets denormalised onto `leads.lead_score`. */
export function totalScore(entries: ScoreEntry[]): number {
  return entries.reduce((sum, e) => sum + e.points, 0);
}
