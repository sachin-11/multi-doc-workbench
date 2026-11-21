import { describe, expect, it } from 'vitest';
import { isAbsenceStatement, isPositionalKey, labelFor, normalizeKey, normalizeValue } from './normalize.js';

describe('normalizeKey (synonyms and periods)', () => {
  it.each([
    ['applicant_name', 'applicant_name'],
    ['director_name', 'applicant_name'],
    ['directors', 'applicant_name'],
    ['name', 'applicant_name'],
    ['full_name', 'applicant_name'],
    ['annual_revenue_2025', 'revenue_fy2025'],
    ['revenue_2025', 'revenue_fy2025'],
    ['revenue_fy2025', 'revenue_fy2025'],
    ['Revenue_FY_2025', 'revenue_fy2025'],
    ['turnover_fy25', 'revenue_fy2025'],
    ['revenue_figure', 'revenue'],
    ['address', 'address'],
    ['registered_address', 'address'],
    ['business_address', 'address'],
    ['licence', 'licence'],
    ['licence_no', 'licence'],
    ['license_number', 'licence'],
    ['trade_licence_number', 'licence'],
    ['licence_expiry', 'licence_expiry'],
    ['license_expiration_date', 'licence_expiry'],
    ['licence_valid_until', 'licence_expiry'],
    ['co_director', 'co_director'],
    ['co_director_name', 'co_director'],
    ['company', 'company'],
    ['company_name', 'company'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeKey(raw).key).toBe(expected);
  });

  it('keeps different reporting periods apart', () => {
    expect(normalizeKey('revenue_fy2024').key).not.toBe(normalizeKey('revenue_fy2025').key);
  });

  it('does not merge an email address with a postal address', () => {
    expect(normalizeKey('email_address').base).not.toBe('address');
  });

  it('keeps a co-director apart from the applicant and the director', () => {
    expect(normalizeKey('co_director_name').base).toBe('co_director');
    expect(normalizeKey('director').base).toBe('applicant_name');
  });

  it('gives human-readable labels', () => {
    expect(labelFor(normalizeKey('annual_revenue_2025'))).toBe('Revenue FY2025');
    expect(labelFor(normalizeKey('licence_no'))).toBe('Licence number');
    expect(labelFor(normalizeKey('net_profit_fy2025'))).toBe('Net profit FY2025');
  });

  it('recognises generated positional keys, which cannot be compared', () => {
    expect(isPositionalKey('amount_1')).toBe(true);
    expect(isPositionalKey('date_12')).toBe(true);
    expect(isPositionalKey('revenue_fy2025')).toBe(false);
  });
});

describe('normalizeValue', () => {
  it('reads Indian digit grouping, currency prefixes and units as the same amount', () => {
    const base = normalizeValue('INR 4,80,00,000');
    expect(normalizeValue('4,80,00,000')).toBe(base);
    expect(normalizeValue('Rs. 4,80,00,000/-')).toBe(base);
    expect(normalizeValue('₹48000000')).toBe(base);
    expect(normalizeValue('4.8 crore')).toBe(base);
    expect(normalizeValue('480 lakh')).toBe(base);
  });

  it('keeps different amounts and different currencies apart', () => {
    expect(normalizeValue('INR 4,80,00,000')).not.toBe(normalizeValue('INR 3,95,00,000'));
    expect(normalizeValue('USD 100')).not.toBe(normalizeValue('INR 100'));
  });

  it('reads the same date in different formats as one value', () => {
    const base = normalizeValue('31-03-2027');
    expect(normalizeValue('31/03/2027')).toBe(base);
    expect(normalizeValue('2027-03-31')).toBe(base);
    expect(normalizeValue('31 March 2027')).toBe(base);
    expect(normalizeValue('March 31, 2027')).toBe(base);
    expect(normalizeValue('31-03-2026')).not.toBe(base);
  });

  it('treats company suffix variants, case and punctuation as formatting', () => {
    expect(normalizeValue('Nimbus Agro Foods Pvt Ltd')).toBe(normalizeValue('Nimbus Agro Foods Private Limited'));
    expect(normalizeValue('NIMBUS  AGRO FOODS PVT. LTD.')).toBe(normalizeValue('Nimbus Agro Foods Private Limited'));
    expect(normalizeValue('Mr. Rohan Mehta')).toBe(normalizeValue('Rohan Mehta'));
  });

  it('still reports different names and addresses as different', () => {
    expect(normalizeValue('Rohan Mehta')).not.toBe(normalizeValue('Rohan Mehra'));
    expect(normalizeValue('14 Lotus Park, Sector 21, Gurugram')).not.toBe(
      normalizeValue('14 Lotus Park, Sector 12, Gurugram'),
    );
  });
});

describe('isAbsenceStatement', () => {
  it.each([
    'No revenue figure is recorded in this summary.',
    'Not provided',
    'not recorded',
    'N/A',
    'None',
    'Unknown',
    '—',
    'No licence number was stated.',
  ])('treats "%s" as a gap', (value) => {
    expect(isAbsenceStatement(value)).toBe(true);
  });

  it.each(['INR 4,80,00,000', 'Rohan Mehta', 'Nilesh Rao', 'Noida, Uttar Pradesh', 'Nimbus Agro Foods', 'Notice period 30 days'])(
    'does not treat "%s" as a gap',
    (value) => {
      expect(isAbsenceStatement(value)).toBe(false);
    },
  );
});
