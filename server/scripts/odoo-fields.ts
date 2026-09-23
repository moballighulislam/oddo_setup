/**
 * Field definitions for Odoo's `crm.lead` model.
 *
 * Three layers, mirroring when a fact becomes known:
 *
 *   x_dn_*  Layer 1 — captured by the website. Machine-written, should be read-only
 *                     to humans: editing a captured fact corrupts the record.
 *   x_q_*   Layer 2 — qualification. Only knowable after a conversation, so these
 *                     should not appear on a New-stage record.
 *   x_d_*   Layer 3 — deal. Commercial terms. Filling these before Proposal means
 *                     guessing, and guessed data makes reporting lie.
 *
 * Odoo natively provides contact_name, email_from, phone, partner_name, function,
 * country_id, source_id / medium_id / campaign_id, priority, tag_ids,
 * expected_revenue, date_deadline and probability — none of those are duplicated here.
 */

export interface FieldDef {
  /** Must start with x_. */
  name: string;
  label: string;
  type: 'char' | 'text' | 'integer' | 'float' | 'boolean' | 'date' | 'datetime' | 'selection';
  /** For selection fields, in display order. */
  options?: Array<[value: string, label: string]>;
  /** Shown as the field's tooltip in Odoo. */
  help?: string;
  /** True for fields worth filtering or grouping on — these go in list views. */
  report?: boolean;
}

// ---------------------------------------------------------------------------
// Layer 1 — captured by the website
// ---------------------------------------------------------------------------

export const LAYER_1: FieldDef[] = [
  // --- scoring and routing ---
  {
    name: 'x_dn_lead_score',
    label: 'Lead score',
    type: 'integer',
    report: true,
    help: 'Composite 0-100. The breakdown is in the description — every point is explainable.',
  },
  {
    name: 'x_dn_routing_tier',
    label: 'Routing tier',
    type: 'selection',
    report: true,
    options: [
      ['enterprise_ae', 'Enterprise AE (80-100)'],
      ['sdr', 'SDR (50-79)'],
      ['nurture', 'Nurture (30-49)'],
      ['marketing_drip', 'Marketing drip (0-29)'],
      ['bypass_support', 'Bypass — support'],
      ['bypass_partnership', 'Bypass — partnership'],
      ['bypass_media', 'Bypass — media'],
    ],
  },
  {
    name: 'x_dn_lifecycle',
    label: 'Lifecycle stage',
    type: 'selection',
    report: true,
    help: 'Where the relationship is. Separate from the pipeline stage, which is where the deal is.',
    options: [
      ['subscriber', 'Subscriber'],
      ['lead', 'Lead'],
      ['sql', 'Sales qualified'],
      ['opportunity', 'Opportunity'],
      ['customer', 'Customer'],
    ],
  },
  { name: 'x_dn_sla_due', label: 'SLA due', type: 'datetime', report: true },

  // --- conversion history ---
  {
    name: 'x_dn_first_form',
    label: 'First conversion',
    type: 'char',
    report: true,
    help: 'The form they first ever submitted.',
  },
  { name: 'x_dn_first_form_date', label: 'First conversion date', type: 'datetime' },
  {
    name: 'x_dn_last_form',
    label: 'Recent conversion',
    type: 'char',
    report: true,
    help: 'The most recent form submitted.',
  },
  { name: 'x_dn_last_form_date', label: 'Recent conversion date', type: 'datetime' },
  {
    name: 'x_dn_submission_count',
    label: 'Form submissions',
    type: 'integer',
    report: true,
    help: 'How many times this person has submitted any form. Repeat submitters are engaged.',
  },
  {
    name: 'x_dn_form_placement',
    label: 'Form placement',
    type: 'char',
    report: true,
    help: 'Where the form sat, e.g. homepage_popup. Reporting only.',
  },

  // --- firmographic ---
  {
    name: 'x_dn_company_size',
    label: 'Company size',
    type: 'selection',
    report: true,
    options: [
      ['1-50', '1-50'],
      ['51-200', '51-200'],
      ['201-1000', '201-1000'],
      ['1000+', '1000+'],
    ],
  },
  {
    name: 'x_dn_solution_interest',
    label: 'Solution interest',
    type: 'char',
    report: true,
    help: 'Which product area. Changes what the demo should cover.',
  },
  {
    name: 'x_dn_frameworks',
    label: 'Frameworks of interest',
    type: 'char',
    report: true,
    help: 'From the form, or parsed from their message.',
  },
  {
    name: 'x_dn_region',
    label: 'Region',
    type: 'selection',
    report: true,
    help: 'The frameworks that matter are regional.',
    options: [
      ['eu', 'EU'],
      ['uk', 'UK'],
      ['us', 'US / Canada'],
      ['apac', 'APAC'],
      ['mea', 'Middle East / Africa'],
      ['latam', 'LATAM'],
      ['other', 'Other'],
    ],
  },
  { name: 'x_dn_company_domain', label: 'Company domain', type: 'char' },

  // --- attribution: the group that matters most before any paid spend ---
  {
    name: 'x_dn_landing_page',
    label: 'Landing page',
    type: 'char',
    report: true,
    help: 'The first page they ever arrived on. Group by this to see which content produces leads.',
  },
  { name: 'x_dn_last_page', label: 'Submitted from page', type: 'char', report: true },
  { name: 'x_dn_referrer', label: 'Referrer', type: 'char', report: true },
  {
    name: 'x_dn_first_touch',
    label: 'First touch source',
    type: 'char',
    report: true,
    help: 'The campaign that originally found them, as opposed to the one that converted them.',
  },
  {
    name: 'x_dn_ad_click_id',
    label: 'Ad click ID',
    type: 'char',
    help: 'Required to import offline conversions back into the ad platform.',
  },
  {
    name: 'x_dn_ad_platform',
    label: 'Ad platform',
    type: 'selection',
    report: true,
    options: [
      ['google', 'Google Ads'],
      ['meta', 'Meta'],
      ['microsoft', 'Microsoft Ads'],
      ['linkedin', 'LinkedIn'],
    ],
  },

  // --- behaviour ---
  {
    name: 'x_dn_days_evaluating',
    label: 'Days evaluating',
    type: 'integer',
    report: true,
    help: 'Days between their first ever visit and this submission. In GRC a long gap is high intent, not a stale lead.',
  },
  { name: 'x_dn_visit_count', label: 'Visits', type: 'integer', report: true },
  { name: 'x_dn_pages_viewed', label: 'Pages this session', type: 'integer' },
  { name: 'x_dn_time_on_site', label: 'Time on site (min)', type: 'integer' },
  { name: 'x_dn_scroll_depth', label: 'Scroll depth (%)', type: 'integer' },
  {
    name: 'x_dn_visited_pricing',
    label: 'Visited pricing',
    type: 'boolean',
    report: true,
  },
  {
    name: 'x_dn_page_journey',
    label: 'Page journey',
    type: 'text',
    help: 'The route through the site, in order.',
  },

  // --- context ---
  { name: 'x_dn_geo_city', label: 'City', type: 'char' },
  { name: 'x_dn_geo_region', label: 'Region / state', type: 'char' },
  {
    name: 'x_dn_geo_isp',
    label: 'Network',
    type: 'char',
    help: 'A corporate ISP is a useful B2B signal.',
  },
  {
    name: 'x_dn_is_hosting_ip',
    label: 'Hosting / VPN IP',
    type: 'boolean',
    report: true,
    help: 'Not necessarily junk, but it explains an odd anti-bot score.',
  },
  { name: 'x_dn_device', label: 'Device', type: 'char' },
  { name: 'x_dn_browser_language', label: 'Browser language', type: 'char' },
  { name: 'x_dn_timezone', label: 'Timezone', type: 'char' },
  { name: 'x_dn_ip_address', label: 'IP address', type: 'char' },

  // --- compliance ---
  {
    name: 'x_dn_consent_given',
    label: 'Marketing consent',
    type: 'boolean',
    report: true,
    help: 'Required before any marketing email. Do not send without it.',
  },
  { name: 'x_dn_consent_at', label: 'Consent given at', type: 'datetime' },
  {
    name: 'x_dn_consent_version',
    label: 'Consent text version',
    type: 'char',
    help: '"They consented" is only defensible if you can show what they agreed to.',
  },
  {
    name: 'x_dn_lead_ref',
    label: 'Backend reference',
    type: 'char',
    help: 'The lead id in the dn-backend database, for tracing.',
  },
];

// ---------------------------------------------------------------------------
// Layer 2 — qualification. Filled by a human after a conversation.
// ---------------------------------------------------------------------------

export const LAYER_2: FieldDef[] = [
  {
    name: 'x_q_audit_deadline',
    label: 'Audit deadline',
    type: 'date',
    report: true,
    help: 'The single most important qualification fact in GRC. Deadlines are why people buy.',
  },
  {
    name: 'x_q_timeline',
    label: 'Buying timeline',
    type: 'selection',
    report: true,
    options: [
      ['immediate', 'Immediate'],
      ['1_3_months', '1-3 months'],
      ['3_6_months', '3-6 months'],
      ['6_plus_months', '6+ months'],
      ['exploring', 'Just exploring'],
    ],
  },
  { name: 'x_q_frameworks_needed', label: 'Frameworks needed', type: 'char', report: true },
  {
    name: 'x_q_current_solution',
    label: 'Current solution',
    type: 'selection',
    report: true,
    options: [
      ['nothing', 'Nothing in place'],
      ['spreadsheets', 'Spreadsheets'],
      ['consultant', 'External consultant'],
      ['competitor', 'Competitor tool'],
      ['in_house', 'In-house build'],
    ],
  },
  {
    name: 'x_q_competitor_name',
    label: 'Competitor in use',
    type: 'char',
    report: true,
    help: 'Which one. The most valuable thing you can learn early.',
  },
  { name: 'x_q_decision_maker', label: 'Speaking to decision maker', type: 'boolean', report: true },
  { name: 'x_q_budget_confirmed', label: 'Budget confirmed', type: 'boolean', report: true },
  { name: 'x_q_team_size', label: 'Compliance team size', type: 'integer' },
  { name: 'x_q_pain_point', label: 'Pain point', type: 'text', help: 'In their words.' },
  { name: 'x_q_blocker', label: 'Blocker', type: 'text', help: 'What is stopping this deal.' },
  { name: 'x_q_next_step', label: 'Agreed next step', type: 'char' },
];

// ---------------------------------------------------------------------------
// Layer 3 — deal. Commercial terms, from Proposal onward.
// ---------------------------------------------------------------------------

export const LAYER_3: FieldDef[] = [
  { name: 'x_d_seats', label: 'Seats', type: 'integer' },
  {
    name: 'x_d_contract_term',
    label: 'Contract term',
    type: 'selection',
    report: true,
    options: [
      ['monthly', 'Monthly'],
      ['annual', 'Annual'],
      ['two_year', '2 year'],
      ['three_year', '3 year'],
    ],
  },
  { name: 'x_d_proposal_sent', label: 'Proposal sent', type: 'date', report: true },
  {
    name: 'x_d_competitor',
    label: 'Competing against',
    type: 'char',
    report: true,
    help: 'Who else is in this deal.',
  },
  { name: 'x_d_champion', label: 'Champion', type: 'char', help: 'Who is pushing internally.' },
  {
    name: 'x_d_economic_buyer',
    label: 'Economic buyer',
    type: 'char',
    help: 'Who actually approves the spend.',
  },
  {
    name: 'x_d_security_review',
    label: 'Security review required',
    type: 'boolean',
    report: true,
    help: 'Enterprise deals usually need one. Adds four to eight weeks.',
  },
  {
    name: 'x_d_procurement_stage',
    label: 'Procurement stage',
    type: 'selection',
    report: true,
    options: [
      ['not_started', 'Not started'],
      ['security', 'Security review'],
      ['legal', 'Legal'],
      ['finance', 'Finance'],
      ['signed', 'Signed'],
    ],
  },
];

export const ALL_FIELDS = [...LAYER_1, ...LAYER_2, ...LAYER_3];
