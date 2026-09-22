import { describe, it, expect } from 'vitest';
import { route, slaDeadline, statusForTier } from '../../src/services/routing.js';

describe('route', () => {
  it('sends an 80+ score to an enterprise AE with a 1 hour SLA', () => {
    const d = route({ score: 90, formId: 'demo_form' });
    expect(d.tier).toBe('enterprise_ae');
    expect(d.slaMinutes).toBe(60);
    expect(d.notifySlack).toBe(true);
  });

  it('does NOT enrol a high scorer in the drip — a rep is calling within the hour', () => {
    // Otherwise the prospect gets an automated email and a human call the same
    // morning, which reads as disorganised.
    expect(route({ score: 95, formId: 'demo_form' }).enrolInSequence).toBe(false);
  });

  it('sends a mid score to an SDR with a 4 hour SLA and enrols them', () => {
    const d = route({ score: 60, formId: 'demo_form' });
    expect(d.tier).toBe('sdr');
    expect(d.slaMinutes).toBe(240);
    expect(d.enrolInSequence).toBe(true);
  });

  it('only alerts Slack for demo forms in the SDR tier', () => {
    expect(route({ score: 60, formId: 'demo_form' }).notifySlack).toBe(true);
    expect(route({ score: 60, formId: 'quick_capture' }).notifySlack).toBe(false);
    expect(route({ score: 60, formId: 'footer_form' }).notifySlack).toBe(false);
  });

  it('routes 30-49 to nurture with no human SLA', () => {
    const d = route({ score: 35, formId: 'quick_capture' });
    expect(d.tier).toBe('nurture');
    expect(d.slaMinutes).toBeNull();
    expect(d.enrolInSequence).toBe(true);
  });

  it('routes a low score to the marketing drip only', () => {
    const d = route({ score: 10, formId: 'footer_form' });
    expect(d.tier).toBe('marketing_drip');
    expect(d.enrolInSequence).toBe(false);
    expect(d.notifySlack).toBe(false);
  });

  it('uses inclusive tier boundaries', () => {
    expect(route({ score: 80, formId: 'demo_form' }).tier).toBe('enterprise_ae');
    expect(route({ score: 79, formId: 'demo_form' }).tier).toBe('sdr');
    expect(route({ score: 50, formId: 'demo_form' }).tier).toBe('sdr');
    expect(route({ score: 49, formId: 'demo_form' }).tier).toBe('nurture');
    expect(route({ score: 30, formId: 'demo_form' }).tier).toBe('nurture');
    expect(route({ score: 29, formId: 'demo_form' }).tier).toBe('marketing_drip');
  });

  describe('inquiry type bypass', () => {
    it('routes support to the support queue regardless of a high score', () => {
      const d = route({ score: 100, formId: 'contact_form', inquiryType: 'support' });
      expect(d.tier).toBe('bypass_support');
      expect(d.notifySlack).toBe(false);
      expect(d.enrolInSequence).toBe(false);
    });

    it('routes partnership to BD and media to press', () => {
      expect(route({ score: 90, formId: 'contact_form', inquiryType: 'partnership' }).tier).toBe(
        'bypass_partnership',
      );
      expect(route({ score: 90, formId: 'contact_form', inquiryType: 'media' }).tier).toBe(
        'bypass_media',
      );
    });

    it('treats a demo request as a real sales lead, not a bypass', () => {
      const d = route({ score: 85, formId: 'contact_form', inquiryType: 'request_demo' });
      expect(d.tier).toBe('enterprise_ae');
    });

    it('treats a general inquiry as a sales lead', () => {
      expect(route({ score: 85, formId: 'contact_form', inquiryType: 'general' }).tier).toBe(
        'enterprise_ae',
      );
    });
  });

  describe('suspected bots', () => {
    it('never assigns or alerts, however high the score', () => {
      const d = route({ score: 100, formId: 'demo_form', isSuspectedBot: true });
      expect(d.notifySlack).toBe(false);
      expect(d.enrolInSequence).toBe(false);
      expect(d.slaMinutes).toBeNull();
    });

    it('takes precedence over an inquiry type bypass', () => {
      const d = route({
        score: 50,
        formId: 'contact_form',
        inquiryType: 'support',
        isSuspectedBot: true,
      });
      expect(d.tier).toBe('marketing_drip');
    });
  });
});

describe('slaDeadline', () => {
  it('adds the tier SLA to the given time', () => {
    const from = new Date('2026-01-01T10:00:00Z');
    const d = route({ score: 90, formId: 'demo_form' });
    expect(slaDeadline(d, from)?.toISOString()).toBe('2026-01-01T11:00:00.000Z');
  });

  it('returns null for tiers with no human SLA', () => {
    expect(slaDeadline(route({ score: 10, formId: 'footer_form' }))).toBeNull();
  });
});

describe('statusForTier', () => {
  it('maps sales tiers to working and automated tiers to nurture', () => {
    expect(statusForTier('enterprise_ae')).toBe('working');
    expect(statusForTier('sdr')).toBe('working');
    expect(statusForTier('nurture')).toBe('nurture');
    expect(statusForTier('marketing_drip')).toBe('nurture');
  });

  it('excludes non-sales inquiries from the pipeline', () => {
    expect(statusForTier('bypass_support')).toBe('disqualified');
    expect(statusForTier('bypass_media')).toBe('disqualified');
  });
});
