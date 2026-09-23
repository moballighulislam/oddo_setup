import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  FORM_SCHEMAS,
  normalise,
  requiresBusinessEmail,
} from '../../src/schemas/forms.js';
import { stripServerOwned } from '../../src/schemas/hidden.js';
import { isFreeEmailDomain, emailDomain } from '../../src/services/antibot.js';

const uuid = () => randomUUID();

describe('form schemas', () => {
  it('accepts a minimal footer signup', () => {
    const r = FORM_SCHEMAS.footer_form.safeParse({
      submission_uuid: uuid(),
      email: 'reader@acme.com',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a submission with no idempotency key', () => {
    const r = FORM_SCHEMAS.footer_form.safeParse({ email: 'reader@acme.com' });
    expect(r.success).toBe(false);
  });

  it('normalises email case and surrounding whitespace', () => {
    const r = FORM_SCHEMAS.footer_form.safeParse({
      submission_uuid: uuid(),
      email: '  Reader@ACME.com  ',
    });
    expect(r.success && r.data.email).toBe('reader@acme.com');
  });

  it('treats phone as optional on quick capture', () => {
    // Deliberate deviation from the spec: GRC buyers withhold a phone number on a
    // first popup, and qualification happens on the call anyway.
    const r = FORM_SCHEMAS.quick_capture.safeParse({
      submission_uuid: uuid(),
      full_name: 'Jane Doe',
      email: 'jane@acme.com',
      company_name: 'Acme',
    });
    expect(r.success).toBe(true);
  });

  it('requires phone on the demo form', () => {
    const r = FORM_SCHEMAS.demo_form.safeParse({
      submission_uuid: uuid(),
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@acme.com',
      company_name: 'Acme',
      job_title: 'CISO',
      company_size: '1000+',
      country: 'GB',
      solution_interest: ['compliance_automation'],
    });
    expect(r.success).toBe(false);
  });

  it('accepts international phone formatting', () => {
    for (const phone of ['+49 30 12345678', '+1 (555) 123-4567', '+91-98765-43210']) {
      const r = FORM_SCHEMAS.demo_form.safeParse({
        submission_uuid: uuid(),
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@acme.com',
        phone,
        company_name: 'Acme',
        job_title: 'CISO',
        company_size: '1000+',
        country: 'GB',
        solution_interest: ['compliance_automation'],
      });
      expect(r.success, `rejected ${phone}`).toBe(true);
    }
  });

  it('rejects an unknown company size', () => {
    const r = FORM_SCHEMAS.demo_form.safeParse({
      submission_uuid: uuid(),
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@acme.com',
      phone: '+15551234567',
      company_name: 'Acme',
      job_title: 'CISO',
      company_size: 'enormous',
      country: 'GB',
      solution_interest: ['compliance_automation'],
    });
    expect(r.success).toBe(false);
  });

  it('requires a message and inquiry type on the contact form', () => {
    const r = FORM_SCHEMAS.contact_form.safeParse({
      submission_uuid: uuid(),
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@acme.com',
      phone: '+15551234567',
      company_name: 'Acme',
    });
    expect(r.success).toBe(false);
  });

  it('keeps unknown fields so raw_payload stays a complete record', () => {
    const r = FORM_SCHEMAS.footer_form.safeParse({
      submission_uuid: uuid(),
      email: 'reader@acme.com',
      brand_new_field_marketing_added: 'surprise',
    });
    expect(r.success && 'brand_new_field_marketing_added' in r.data).toBe(true);
  });

  it('truncates an over-long referrer instead of failing the submission', () => {
    const r = FORM_SCHEMAS.footer_form.safeParse({
      submission_uuid: uuid(),
      email: 'reader@acme.com',
      referrer_url: 'https://x.com/?q=' + 'a'.repeat(3000),
    });
    expect(r.success).toBe(true);
    expect(r.success && (r.data.referrer_url?.length ?? 0)).toBeLessThanOrEqual(1000);
  });
});

describe('normalise', () => {
  it('splits a single full_name into first and last', () => {
    const n = normalise('quick_capture', {
      submission_uuid: uuid(),
      form_name: 'homepage_popup',
      full_name: 'Jane Doe',
      email: 'jane@acme.com',
      company_name: 'Acme',
      consent_given: false,
    } as never);
    expect(n.firstName).toBe('Jane');
    expect(n.lastName).toBe('Doe');
  });

  it('treats everything after the first token as the surname', () => {
    const n = normalise('quick_capture', {
      submission_uuid: uuid(),
      form_name: 'homepage_popup',
      full_name: 'Maria del Carmen Garcia',
      email: 'maria@acme.com',
      company_name: 'Acme',
      consent_given: false,
    } as never);
    expect(n.firstName).toBe('Maria');
    expect(n.lastName).toBe('del Carmen Garcia');
  });

  it('handles a mononym without inventing a surname', () => {
    const n = normalise('quick_capture', {
      submission_uuid: uuid(),
      form_name: 'homepage_popup',
      full_name: 'Prince',
      email: 'p@acme.com',
      company_name: 'Acme',
      consent_given: false,
    } as never);
    expect(n.firstName).toBe('Prince');
    expect(n.lastName).toBeUndefined();
  });

  it('prefers explicit first/last fields when present', () => {
    const n = normalise('demo_form', {
      submission_uuid: uuid(),
      form_name: 'book_a_demo',
      first_name: 'Elena',
      last_name: 'Fischer',
      email: 'elena@acme.com',
      consent_given: true,
    } as never);
    expect(n.firstName).toBe('Elena');
    expect(n.lastName).toBe('Fischer');
  });
});

describe('stripServerOwned', () => {
  it('removes fields a client must never set', () => {
    const out = stripServerOwned({
      email: 'attacker@evil.com',
      lead_score: 100,
      assigned_to: 'ceo@company.com',
      routing_tier: 'enterprise_ae',
      leadScore: 100,
      ipAddress: '1.2.3.4',
    });
    expect(out).toEqual({ email: 'attacker@evil.com' });
  });

  it('leaves legitimate fields untouched', () => {
    const input = { email: 'a@b.com', full_name: 'A B', utm_source: 'google' };
    expect(stripServerOwned(input)).toEqual(input);
  });
});

describe('email domain rules', () => {
  it('flags free and disposable providers', () => {
    for (const e of ['x@gmail.com', 'x@yahoo.com', 'x@outlook.com', 'x@mailinator.com']) {
      expect(isFreeEmailDomain(e), e).toBe(true);
    }
  });

  it('does not flag company domains', () => {
    for (const e of ['x@acme.com', 'x@meridian-bank.com', 'x@lumen-labs.io']) {
      expect(isFreeEmailDomain(e), e).toBe(false);
    }
  });

  it('exempts only the newsletter form from the business-email rule', () => {
    expect(requiresBusinessEmail('footer_form')).toBe(false);
    expect(requiresBusinessEmail('demo_form')).toBe(true);
    expect(requiresBusinessEmail('quick_capture')).toBe(true);
    expect(requiresBusinessEmail('contact_form')).toBe(true);
  });

  it('extracts the domain for enrichment', () => {
    expect(emailDomain('Jane@Acme.COM')).toBe('acme.com');
  });
});

describe('country and solution interest', () => {
  const demo = (over: Record<string, unknown> = {}) => ({
    submission_uuid: uuid(),
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@acme-corp.com',
    phone: '+15551234567',
    company_name: 'Acme',
    job_title: 'CISO',
    company_size: '1000+',
    country: 'DE',
    solution_interest: ['compliance_automation'],
    ...over,
  });

  it('requires both on the demo form', () => {
    expect(FORM_SCHEMAS.demo_form.safeParse(demo()).success).toBe(true);
    expect(FORM_SCHEMAS.demo_form.safeParse(demo({ country: undefined })).success).toBe(false);
    expect(
      FORM_SCHEMAS.demo_form.safeParse(demo({ solution_interest: undefined })).success,
    ).toBe(false);
  });

  it('normalises the country code to uppercase', () => {
    const r = FORM_SCHEMAS.demo_form.safeParse(demo({ country: 'de' }));
    expect(r.success && r.data.country).toBe('DE');
  });

  it('rejects anything that is not a two-letter code', () => {
    for (const bad of ['Germany', 'D', 'DEU', '12']) {
      expect(FORM_SCHEMAS.demo_form.safeParse(demo({ country: bad })).success, bad).toBe(false);
    }
  });

  it('accepts several solutions but rejects an empty list', () => {
    expect(
      FORM_SCHEMAS.demo_form.safeParse(
        demo({ solution_interest: ['risk_management', 'ai_governance'] }),
      ).success,
    ).toBe(true);
    expect(FORM_SCHEMAS.demo_form.safeParse(demo({ solution_interest: [] })).success).toBe(false);
  });

  it('rejects an unknown solution', () => {
    expect(
      FORM_SCHEMAS.demo_form.safeParse(demo({ solution_interest: ['blockchain'] })).success,
    ).toBe(false);
  });

  it('leaves country optional on the contact form', () => {
    // That form is used when something is already wrong; extra friction is worse
    // than a missing country.
    const r = FORM_SCHEMAS.contact_form.safeParse({
      submission_uuid: uuid(),
      first_name: 'Tara',
      last_name: 'Singh',
      email: 'tara@acme-corp.com',
      phone: '+15551234567',
      company_name: 'Acme',
      inquiry_type: 'support',
      message: 'SSO broken',
    });
    expect(r.success).toBe(true);
  });

  it('does not ask the low-commitment forms for either', () => {
    expect(
      FORM_SCHEMAS.quick_capture.safeParse({
        submission_uuid: uuid(),
        full_name: 'Jane Doe',
        email: 'jane@acme-corp.com',
        company_name: 'Acme',
      }).success,
    ).toBe(true);
  });

  it('carries both through normalise', () => {
    const n = normalise('demo_form', demo() as never);
    expect(n.countryCode).toBe('DE');
    expect(n.solutionInterest).toEqual(['compliance_automation']);
  });
});

describe('regionForCountry', () => {
  it('groups countries into the regions that share a compliance regime', async () => {
    const { regionForCountry } = await import('../../src/schemas/enums.js');
    expect(regionForCountry('DE')).toBe('eu');
    expect(regionForCountry('FR')).toBe('eu');
    expect(regionForCountry('GB')).toBe('uk'); // left the EU, different regime
    expect(regionForCountry('US')).toBe('us');
    expect(regionForCountry('IN')).toBe('apac');
    expect(regionForCountry('AE')).toBe('mea');
    expect(regionForCountry('BR')).toBe('latam');
    expect(regionForCountry('XX')).toBe('other');
    expect(regionForCountry(null)).toBeNull();
  });

  it('is case-insensitive', async () => {
    const { regionForCountry } = await import('../../src/schemas/enums.js');
    expect(regionForCountry('de')).toBe('eu');
  });
});
