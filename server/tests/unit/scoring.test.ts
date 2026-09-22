import { describe, it, expect } from 'vitest';
import { computeScore, totalScore } from '../../src/services/scoring.js';
import { SCORE_CAPS } from '../../src/schemas/enums.js';

describe('computeScore', () => {
  it('awards the documented maximum to a CISO at a 1000+ company booking a demo', () => {
    const entries = computeScore({
      formId: 'demo_form',
      companySize: '1000+',
      jobTitle: 'Chief Information Security Officer',
      visitedPricing: true,
      visitCount: 3,
      pagesViewed: 8,
    });

    // 30 form_intent + 25 firmographic + 25 job_title + 20 behavioral
    expect(totalScore(entries)).toBe(100);
  });

  it('never exceeds 100 however many signals stack', () => {
    const entries = computeScore({
      formId: 'demo_form',
      companySize: '1000+',
      jobTitle: 'CISO',
      visitedPricing: true,
      visitCount: 99,
      pagesViewed: 500,
    });
    expect(totalScore(entries)).toBeLessThanOrEqual(100);
  });

  it('caps each category independently', () => {
    const entries = computeScore({
      formId: 'demo_form',
      companySize: '1000+',
      jobTitle: 'CISO',
      visitedPricing: true,
      visitCount: 5,
      pagesViewed: 20,
    });

    for (const category of Object.keys(SCORE_CAPS) as (keyof typeof SCORE_CAPS)[]) {
      const sum = entries
        .filter((e) => e.category === category)
        .reduce((acc, e) => acc + e.points, 0);
      expect(sum).toBeLessThanOrEqual(SCORE_CAPS[category]);
    }
  });

  it('ranks form intent demo > contact > quick capture > footer', () => {
    const score = (formId: 'demo_form' | 'contact_form' | 'quick_capture' | 'footer_form') =>
      totalScore(computeScore({ formId }));

    expect(score('demo_form')).toBeGreaterThan(score('contact_form'));
    expect(score('contact_form')).toBeGreaterThan(score('quick_capture'));
    expect(score('quick_capture')).toBeGreaterThan(score('footer_form'));
  });

  it('scores a footer-only signup low enough for the marketing drip tier', () => {
    expect(totalScore(computeScore({ formId: 'footer_form' }))).toBeLessThan(30);
  });

  it('matches the most senior title pattern, not the first weak one', () => {
    // "VP of Risk and Compliance" contains "compliance", which a naive matcher
    // would score as a manager.
    const vp = computeScore({ formId: 'demo_form', jobTitle: 'VP of Risk and Compliance' });
    const manager = computeScore({ formId: 'demo_form', jobTitle: 'Compliance Manager' });

    const titlePoints = (entries: ReturnType<typeof computeScore>) =>
      entries.find((e) => e.category === 'job_title')?.points ?? 0;

    expect(titlePoints(vp)).toBeGreaterThan(titlePoints(manager));
  });

  it('gives a non-buyer role zero title points', () => {
    const entries = computeScore({ formId: 'demo_form', jobTitle: 'PhD Student' });
    expect(entries.find((e) => e.category === 'job_title')?.points ?? 0).toBe(0);
  });

  it('still credits an unrecognised but supplied title', () => {
    const entries = computeScore({ formId: 'demo_form', jobTitle: 'Chief Vibes Wrangler' });
    expect(entries.find((e) => e.category === 'job_title')?.points).toBeGreaterThan(0);
  });

  it('omits firmographic and title entries entirely when the fields are absent', () => {
    const entries = computeScore({ formId: 'footer_form' });
    expect(entries.some((e) => e.category === 'firmographic')).toBe(false);
    expect(entries.some((e) => e.category === 'job_title')).toBe(false);
  });

  it('gives every entry a human-readable reason', () => {
    const entries = computeScore({
      formId: 'demo_form',
      companySize: '51-200',
      jobTitle: 'Director of Security',
      visitedPricing: true,
    });
    for (const entry of entries) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('does not count a first-time visitor as a return visitor', () => {
    const entries = computeScore({ formId: 'quick_capture', visitCount: 1 });
    expect(entries.some((e) => e.reason.includes('Return visitor'))).toBe(false);
  });
});
