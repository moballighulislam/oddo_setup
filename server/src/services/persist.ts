/**
 * Persistence for a form submission.
 *
 * One transaction writes three tables: upsert the lead, insert the submission,
 * insert its tracking row. Partial writes are the failure mode to avoid — a
 * submission row with no tracking row is a lead whose attribution is gone.
 */
import { ulid } from 'ulid';
import { prisma } from '../db.js';
import type { FormId } from '../schemas/enums.js';
import type { HiddenFields } from '../schemas/hidden.js';
import type { NormalisedSubmission } from '../schemas/forms.js';
import { emailDomain } from './antibot.js';
import { computeScore, totalScore } from './scoring.js';
import { route, slaDeadline, statusForTier } from './routing.js';
import { regionForCountry } from '../schemas/enums.js';
import { dispatchForSubmission } from '../queue/dispatch.js';

export interface PersistInput {
  formId: FormId;
  formName: string;
  submissionUuid: string;
  data: NormalisedSubmission;
  hidden: HiddenFields;
  rawPayload: unknown;
  /** Server-derived, never taken from the request body. */
  ipAddress: string | null;
  userAgent: string | null;
  /** Two-letter country from the CDN edge. More trustworthy than anything the client sends. */
  geoCountry: string | null;
  /** Parsed from the user agent, used only when the tracking snippet reported nothing. */
  deviceTypeFallback: string | null;
  isSuspectedBot: boolean;
  botReason: string | null;
  recaptchaScore: number | null;
}

export interface PersistResult {
  leadPublicId: string;
  submissionPublicId: string;
  submissionId: number;
  leadId: number;
  score: number;
  routingTier: string;
  /** True when this exact submissionUuid had already been stored. */
  wasDuplicate: boolean;
}

/**
 * Store a submission.
 *
 * Idempotent on `submissionUuid`: a double-click or a client retry returns the
 * original result instead of creating a second lead.
 */
export async function persistSubmission(input: PersistInput): Promise<PersistResult> {
  // Idempotency check before the transaction. The unique index is the real
  // guarantee; this is the fast path that avoids doing the work twice.
  const existing = await prisma.formSubmission.findUnique({
    where: { submissionUuid: input.submissionUuid },
    include: { lead: true },
  });

  if (existing) {
    return {
      leadPublicId: existing.lead.publicId,
      submissionPublicId: existing.publicId,
      submissionId: existing.id,
      leadId: existing.leadId,
      score: existing.lead.leadScore,
      routingTier: existing.lead.routingTier ?? 'unknown',
      wasDuplicate: true,
    };
  }

  const { data, hidden } = input;
  const now = new Date();

  // Score and route before the transaction — both are pure, and doing the work
  // outside keeps the transaction short. SQLite serialises writes, so a long
  // transaction blocks every other submission.
  const scoreEntries = computeScore({
    formId: input.formId,
    companySize: data.companySize,
    jobTitle: data.jobTitle,
    visitedPricing: hidden.visited_pricing,
    visitCount: hidden.visit_count,
    pagesViewed: hidden.pages_viewed,
  });
  const score = totalScore(scoreEntries);

  const decision = route({
    score,
    formId: input.formId,
    inquiryType: data.inquiryType,
    isSuspectedBot: input.isSuspectedBot,
  });

  const convertingSource = hidden.utm_source ?? hidden.last_touch_src ?? deriveSource(hidden);

  return prisma.$transaction(async (tx) => {
    // ---- 1. Lead: create, or fill gaps in an existing record ----------------
    //
    // The update half never overwrites a known value with null. A footer
    // subscriber who later books a demo gains a job title; a demo requester who
    // later uses the footer form must not lose one.
    const lead = await tx.lead.upsert({
      where: { email: data.email },
      create: {
        publicId: ulid(),
        email: data.email,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        phoneE164: data.phone ?? null, // normalised later by the enrich job
        companyName: data.companyName ?? null,
        jobTitle: data.jobTitle ?? null,
        companySize: data.companySize ?? null,
        frameworkInterest: data.frameworkInterest?.join(',') ?? null,
        companyDomain: emailDomain(data.email),
        solutionInterest: data.solutionInterest?.join(',') ?? null,
        // A declared country beats one derived from the IP. Corporate VPNs routinely
        // report the wrong country, and GRC is jurisdiction-specific enough that
        // getting this wrong sends the buyer the wrong frameworks.
        countryCode: data.countryCode ?? input.geoCountry,
        regionGroup: regionForCountry(data.countryCode ?? input.geoCountry),
        leadScore: score,
        leadStatus: statusForTier(decision.tier),
        assignedTo: decision.assignedTo,
        routingTier: decision.tier,
        slaDueAt: slaDeadline(decision, now),
        consentGiven: data.consentGiven,
        consentIp: data.consentGiven ? input.ipAddress : null,
        consentTextVersion: data.consentTextVersion ?? null,
        consentAt: data.consentGiven ? now : null,
        // first touch is write-once: set here, never in the update branch
        firstTouchSource: hidden.first_touch_src ?? convertingSource,
        lastTouchSource: convertingSource,
      },
      update: {
        firstName: data.firstName ?? undefined,
        lastName: data.lastName ?? undefined,
        phoneE164: data.phone ?? undefined,
        companyName: data.companyName ?? undefined,
        jobTitle: data.jobTitle ?? undefined,
        companySize: data.companySize ?? undefined,
        frameworkInterest: data.frameworkInterest?.join(',') ?? undefined,
        solutionInterest: data.solutionInterest?.join(',') ?? undefined,
        // Only a declared country overwrites what is already there — a later
        // geo guess must not replace something the visitor told us.
        ...(data.countryCode
          ? {
              countryCode: data.countryCode,
              regionGroup: regionForCountry(data.countryCode),
            }
          : {}),
        lastTouchSource: convertingSource ?? undefined,
        // Consent can be granted but never silently revoked by a later form.
        ...(data.consentGiven
          ? {
              consentGiven: true,
              consentIp: input.ipAddress,
              consentTextVersion: data.consentTextVersion ?? undefined,
              consentAt: now,
            }
          : {}),
      },
    });

    // ---- 2. Submission -----------------------------------------------------
    const submission = await tx.formSubmission.create({
      data: {
        publicId: ulid(),
        leadId: lead.id,
        submissionUuid: input.submissionUuid,
        formId: input.formId,
        formName: input.formName,
        inquiryType: data.inquiryType ?? null,
        messageText: data.message ?? null,
        rawPayload: JSON.stringify(input.rawPayload),
        recaptchaScore: input.recaptchaScore,
        isSuspectedBot: input.isSuspectedBot,
        botReason: input.botReason,
      },
    });

    // ---- 3. Tracking -------------------------------------------------------
    await tx.trackingData.create({
      data: {
        submissionId: submission.id,
        utmSource: hidden.utm_source ?? null,
        utmMedium: hidden.utm_medium ?? null,
        utmCampaign: hidden.utm_campaign ?? null,
        utmTerm: hidden.utm_term ?? null,
        utmContent: hidden.utm_content ?? null,
        firstTouchSrc: hidden.first_touch_src ?? null,
        lastTouchSrc: hidden.last_touch_src ?? null,
        pageUrl: hidden.page_url ?? null,
        referrerUrl: hidden.referrer_url ?? null,
        landingPage: hidden.landing_page ?? null,
        gclid: hidden.gclid ?? null,
        fbclid: hidden.fbclid ?? null,
        msclkid: hidden.msclkid ?? null,
        liFatId: hidden.li_fat_id ?? null,
        sessionId: hidden.session_id ?? null,
        pagesViewed: hidden.pages_viewed ?? null,
        visitCount: hidden.visit_count ?? null,
        timeOnSiteSec: hidden.time_on_site_sec ?? null,
        visitedPricing: hidden.visited_pricing ?? false,
        // Stored as JSON text — the schema avoids the Json scalar for SQLite
        // portability. Becomes a real JSON column on the MySQL switch.
        pageJourney: hidden.page_journey ? JSON.stringify(hidden.page_journey) : null,
        daysSinceFirstVisit: hidden.days_since_first_visit ?? null,
        scrollDepth: hidden.scroll_depth ?? null,
        browserLanguage: hidden.browser_language ?? null,
        browserTimezone: hidden.browser_timezone ?? null,
        // Client value wins when present — it knows about viewport and touch
        // support, which a user-agent string does not.
        deviceType: hidden.device_type ?? input.deviceTypeFallback,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        geoCountry: input.geoCountry,
      },
    });

    // ---- 4. Score ledger ---------------------------------------------------
    //
    // Re-scored on every submission because the facts change: a footer subscriber
    // who later books a demo genuinely is a different lead. Old rows stay for the
    // audit trail, so the rollup is set explicitly rather than incremented.
    if (scoreEntries.length > 0) {
      await tx.leadScore.createMany({
        data: scoreEntries.map((entry) => ({
          leadId: lead.id,
          category: entry.category,
          points: entry.points,
          reason: entry.reason,
          submissionId: submission.id,
        })),
      });

      // On a repeat submission the upsert's update branch did not touch scoring
      // fields, so apply the new decision here.
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          leadScore: score,
          leadStatus: statusForTier(decision.tier),
          assignedTo: decision.assignedTo,
          routingTier: decision.tier,
          slaDueAt: slaDeadline(decision, now),
        },
      });
    }

    // ---- 5. Newsletter subscription ---------------------------------------
    //
    // The footer form is a newsletter signup. Any other form only subscribes when
    // consent was explicitly given — a demo request is not permission to market.
    const shouldSubscribe = input.formId === 'footer_form' || data.consentGiven;
    if (shouldSubscribe && !input.isSuspectedBot) {
      await tx.newsletterSubscriber.upsert({
        where: { email: data.email },
        create: {
          email: data.email,
          leadId: lead.id,
          fullName: [data.firstName, data.lastName].filter(Boolean).join(' ') || null,
          status: 'subscribed',
          unsubscribeToken: ulid() + ulid(), // 52 chars, unguessable
          consentGiven: data.consentGiven,
          consentIp: input.ipAddress,
          sourcePage: hidden.page_url ?? null,
          sourceReferrer: hidden.referrer_url ?? null,
        },
        // Deliberately does NOT reset status. Re-submitting a form must never
        // resurrect someone who unsubscribed — that is the suppression list's
        // entire purpose.
        update: { leadId: lead.id },
      });
    }

    // ---- 6. Enqueue the slow work -----------------------------------------
    //
    // Inside the transaction on purpose: the jobs commit atomically with the lead.
    // Enqueueing after commit leaves a window where the process can die having
    // stored a lead that nothing will ever act on.
    await dispatchForSubmission(
      {
        leadId: lead.id,
        submissionId: submission.id,
        formId: input.formId,
        inquiryType: data.inquiryType,
        isSuspectedBot: input.isSuspectedBot,
        hasMessage: Boolean(data.message),
      },
      tx,
    );

    return {
      leadPublicId: lead.publicId,
      submissionPublicId: submission.publicId,
      submissionId: submission.id,
      leadId: lead.id,
      score,
      routingTier: decision.tier,
      wasDuplicate: false,
    };
  });
}

/** Fall back to classifying the referrer when no UTM parameters are present. */
function deriveSource(hidden: HiddenFields): string {
  const ref = hidden.referrer_url;
  if (!ref) return 'direct';

  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    if (/google|bing|duckduckgo|yahoo/.test(host)) return 'organic-search';
    if (/linkedin|twitter|x\.com|facebook|reddit/.test(host)) return 'organic-social';
    return `referral:${host}`;
  } catch {
    return 'direct';
  }
}
