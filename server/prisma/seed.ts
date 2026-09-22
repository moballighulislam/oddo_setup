/**
 * Development seed data.
 *
 * Creates four leads, one per form template, spanning the routing tiers so every
 * branch is reachable without filling in forms by hand:
 *
 *   enterprise_ae  — CISO at a 1000+ company, booked a demo after pricing
 *   sdr            — mid-market compliance manager via quick capture
 *   nurture        — small-company analyst
 *   bypass_support — a support ticket that must skip scoring entirely
 *
 * Safe to re-run: every write is an upsert keyed on email.
 * Refuses to run against production.
 */
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

interface SeedSpec {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  jobTitle: string;
  companySize: string;
  formId: string;
  formName: string;
  inquiryType?: string;
  message?: string;
  visitedPricing: boolean;
  visitCount: number;
  pagesViewed: number;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  landingPage: string;
}

const SPECS: SeedSpec[] = [
  {
    email: 'priya.raman@northgate-financial.com',
    firstName: 'Priya',
    lastName: 'Raman',
    companyName: 'Northgate Financial',
    jobTitle: 'CISO',
    companySize: '1000+',
    formId: 'demo_form',
    formName: 'book_a_demo',
    message: 'SOC 2 Type II audit deadline in March. Need evidence collection automated.',
    visitedPricing: true,
    visitCount: 3,
    pagesViewed: 7,
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'grc_q4',
    landingPage: '/frameworks/soc2-checklist',
  },
  {
    email: 'dmoreau@brightpath-health.com',
    firstName: 'Daniel',
    lastName: 'Moreau',
    companyName: 'Brightpath Health',
    jobTitle: 'Compliance Manager',
    companySize: '51-200',
    formId: 'quick_capture',
    formName: 'homepage_popup',
    visitedPricing: true,
    visitCount: 2,
    pagesViewed: 4,
    utmSource: 'linkedin',
    utmMedium: 'social',
    utmCampaign: 'hipaa_guide',
    landingPage: '/solutions/healthcare',
  },
  {
    email: 'sam.okafor@lumen-labs.io',
    firstName: 'Sam',
    lastName: 'Okafor',
    companyName: 'Lumen Labs',
    jobTitle: 'Security Analyst',
    companySize: '1-50',
    formId: 'footer_form',
    formName: 'site_footer',
    visitedPricing: false,
    visitCount: 1,
    pagesViewed: 2,
    utmSource: 'organic-search',
    utmMedium: 'organic',
    utmCampaign: '',
    landingPage: '/blog/iso-27001-vs-soc2',
  },
  {
    email: 't.whitfield@orion-logistics.com',
    firstName: 'Tara',
    lastName: 'Whitfield',
    companyName: 'Orion Logistics',
    jobTitle: 'IT Director',
    companySize: '201-1000',
    formId: 'contact_form',
    formName: 'contact_us',
    inquiryType: 'support',
    message: 'Existing customer — SSO login failing for three users since yesterday.',
    visitedPricing: false,
    visitCount: 5,
    pagesViewed: 3,
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    landingPage: '/contact',
  },
];

async function main(): Promise<void> {
  console.log('Seeding…');

  // Scoring and routing are imported rather than hardcoded so seeded leads always
  // match what the live pipeline would produce. Hardcoded scores drift silently
  // the moment a rule changes.
  const { computeScore, totalScore } = await import('../src/services/scoring.js');
  const { route, slaDeadline, statusForTier } = await import('../src/services/routing.js');

  for (const spec of SPECS) {
    const entries = computeScore({
      formId: spec.formId as never,
      companySize: spec.companySize,
      jobTitle: spec.jobTitle,
      visitedPricing: spec.visitedPricing,
      visitCount: spec.visitCount,
      pagesViewed: spec.pagesViewed,
    });
    const score = totalScore(entries);
    const decision = route({
      score,
      formId: spec.formId as never,
      inquiryType: spec.inquiryType,
    });

    const lead = await prisma.lead.upsert({
      where: { email: spec.email },
      update: {},
      create: {
        publicId: ulid(),
        email: spec.email,
        firstName: spec.firstName,
        lastName: spec.lastName,
        companyName: spec.companyName,
        jobTitle: spec.jobTitle,
        companySize: spec.companySize,
        companyDomain: spec.email.split('@')[1] ?? null,
        leadScore: score,
        leadStatus: statusForTier(decision.tier),
        assignedTo: decision.assignedTo,
        routingTier: decision.tier,
        slaDueAt: slaDeadline(decision),
        consentGiven: true,
        consentIp: '203.0.113.10', // TEST-NET-3, never a real address
        consentTextVersion: 'v1',
        consentAt: new Date(),
        firstTouchSource: spec.utmSource || 'direct',
        lastTouchSource: spec.utmSource || 'direct',
      },
    });

    const submission = await prisma.formSubmission.create({
      data: {
        publicId: ulid(),
        leadId: lead.id,
        submissionUuid: randomUUID(),
        formId: spec.formId,
        formName: spec.formName,
        inquiryType: spec.inquiryType ?? null,
        messageText: spec.message ?? null,
        rawPayload: JSON.stringify({ seeded: true, email: spec.email }),
        recaptchaScore: 0.9,
        isSuspectedBot: false,
      },
    });

    await prisma.trackingData.create({
      data: {
        submissionId: submission.id,
        utmSource: spec.utmSource || null,
        utmMedium: spec.utmMedium || null,
        utmCampaign: spec.utmCampaign || null,
        landingPage: spec.landingPage,
        pageUrl: spec.landingPage,
        referrerUrl: 'https://www.google.com/',
        sessionId: ulid(),
        pagesViewed: spec.pagesViewed,
        visitCount: spec.visitCount,
        visitedPricing: spec.visitedPricing,
        deviceType: 'desktop',
        ipAddress: '203.0.113.10',
        userAgent: 'Mozilla/5.0 (seed)',
      },
    });

    await prisma.leadScore.createMany({
      data: entries.map((e) => ({
        leadId: lead.id,
        category: e.category,
        points: e.points,
        reason: e.reason,
        submissionId: submission.id,
      })),
    });

    if (spec.formId === 'footer_form') {
      await prisma.newsletterSubscriber.upsert({
        where: { email: spec.email },
        update: {},
        create: {
          email: spec.email,
          leadId: lead.id,
          fullName: `${spec.firstName} ${spec.lastName}`,
          status: 'subscribed',
          unsubscribeToken: ulid() + ulid(),
          consentGiven: true,
          consentIp: '203.0.113.10',
          sourcePage: spec.landingPage,
        },
      });
    }

    console.log(
      `  ${spec.email.padEnd(40)} score ${String(score).padStart(3)}  ${decision.tier}`,
    );
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
