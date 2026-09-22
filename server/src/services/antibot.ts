/**
 * Anti-bot checks.
 *
 * Governing rule: FLAG, NEVER DROP. Every check here returns a verdict, and a
 * failed verdict still results in a stored row with `is_suspected_bot` set.
 * A false positive that silently discards a real enterprise lead costs far more
 * than a spam row costs to filter at read time.
 *
 * Three layers, cheapest first:
 *   1. Honeypot        — free, catches naive form-fillers
 *   2. Submit speed    — free, catches scripted submits
 *   3. reCAPTCHA v3    — a network call, so it runs last
 */
import { env, recaptchaEnabled } from '../env.js';
import { logger } from '../lib/logger.js';
import type { BotReason } from '../schemas/enums.js';

export interface BotVerdict {
  isSuspected: boolean;
  reason: BotReason | null;
  score: number | null;
}

const CLEAN: BotVerdict = { isSuspected: false, reason: null, score: null };

export interface BotCheckInput {
  /** Honeypot field value. A real browser leaves it empty. */
  honeypot?: string | undefined;
  /** Milliseconds between form render and submit, reported by the client. */
  formRenderMs?: number | undefined;
  /** reCAPTCHA v3 token. */
  token?: string | undefined;
  remoteIp?: string | undefined;
}

/**
 * Run all checks and return the first failure.
 *
 * Short-circuits on the free checks so a bot-filled form never costs a reCAPTCHA
 * round trip.
 */
export async function checkSubmission(input: BotCheckInput): Promise<BotVerdict> {
  // 1. Honeypot — a hidden input no human ever sees or fills.
  if (input.honeypot && input.honeypot.trim().length > 0) {
    return { isSuspected: true, reason: 'honeypot', score: null };
  }

  // 2. Submit speed. Client-reported and therefore spoofable, but it costs nothing
  //    and catches unsophisticated scripts. Absent value is not held against the
  //    submitter — the tracking snippet may simply not have loaded.
  if (input.formRenderMs !== undefined) {
    const elapsedSeconds = input.formRenderMs / 1000;
    if (elapsedSeconds < env.MIN_SUBMIT_SECONDS) {
      return { isSuspected: true, reason: 'too_fast', score: null };
    }
  }

  // 3. reCAPTCHA v3. Skipped entirely when no secret is configured (dev).
  if (!recaptchaEnabled) return CLEAN;

  if (!input.token) {
    // Verification is on but the client sent no token. Suspicious, not fatal.
    return { isSuspected: true, reason: 'low_score', score: null };
  }

  const score = await verifyRecaptcha(input.token, input.remoteIp);

  // A null score means the verification call itself failed (network, outage).
  // Give the submitter the benefit of the doubt — a reCAPTCHA outage must not
  // silently turn every real lead into a suspected bot.
  if (score === null) return CLEAN;

  if (score < env.RECAPTCHA_SCORE_THRESHOLD) {
    return { isSuspected: true, reason: 'low_score', score };
  }

  return { isSuspected: false, reason: null, score };
}

/**
 * Verify a reCAPTCHA v3 token with Google.
 * Returns the score, or null if the call could not be completed.
 */
async function verifyRecaptcha(token: string, remoteIp?: string): Promise<number | null> {
  const body = new URLSearchParams({
    secret: env.RECAPTCHA_SECRET_KEY,
    response: token,
  });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    // Hard timeout: this sits in the request path and must not hang a submission.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn({ status: res.status }, 'recaptcha verify returned non-200');
      return null;
    }

    const data = (await res.json()) as {
      success: boolean;
      score?: number;
      'error-codes'?: string[];
    };

    if (!data.success) {
      logger.warn({ errors: data['error-codes'] }, 'recaptcha verify unsuccessful');
      // An explicitly unsuccessful verification is a real signal, unlike a network
      // failure. Score 0 so the threshold check flags it.
      return 0;
    }

    return data.score ?? null;
  } catch (err) {
    logger.warn({ err }, 'recaptcha verify failed — treating submission as clean');
    return null;
  }
}

/**
 * Free/personal email providers.
 *
 * Blocked on lead forms because a GRC platform sells to organisations, and a
 * gmail address carries no company to enrich or score. The footer newsletter is
 * exempt — an individual practitioner subscribing is a legitimate audience.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mail.com',
  'gmx.com',
  'yandex.com',
  'zoho.com',
  'protonmail.com',
  'proton.me',
  'rediffmail.com',
  // disposable providers
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
  'sharklasers.com',
  'temp-mail.org',
]);

export function isFreeEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return FREE_EMAIL_DOMAINS.has(domain);
}

/** Domain portion of an email, used for firmographic enrichment. */
export function emailDomain(email: string): string | null {
  return email.split('@')[1]?.toLowerCase() ?? null;
}
