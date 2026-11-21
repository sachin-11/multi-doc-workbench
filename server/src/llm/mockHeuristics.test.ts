import { describe, expect, it } from 'vitest';
import { canonicalKey, extractFactsFromText } from './mockExtraction.js';
import { normalizeForComparison } from './mockAnalysis.js';

describe('canonicalKey (MOCK key normalisation)', () => {
  it.each([
    ['Annual Revenue FY2025', 'revenue_fy2025'],
    ['Revenue FY2025', 'revenue_fy2025'],
    ['revenue fy2025', 'revenue_fy2025'],
    ['Trade Licence No', 'licence'],
    ['Licence No', 'licence'],
    ['Licence Expiry', 'licence_expiry'],
    ['Registered Address', 'address'],
    ['Address', 'address'],
    ['Applicant Name', 'applicant'],
    ['Applicant', 'applicant'],
    ['Company name', 'company'],
    ['Company', 'company'],
    ['Directors', 'director'],
    ['Co-director', 'co_director'],
  ])('maps "%s" to "%s"', (label, expected) => {
    expect(canonicalKey(label)).toBe(expected);
  });

  it('keeps the period, so figures for different years are never merged', () => {
    expect(canonicalKey('Revenue FY2024')).not.toBe(canonicalKey('Revenue FY2025'));
  });

  it('falls back to the plain key when every token is filler', () => {
    expect(canonicalKey('Name')).toBe('name');
  });
});

describe('MOCK extraction of long-form CSV tables', () => {
  const csv = [
    'Columns: metric, fy2024, fy2025',
    'Row 1: metric=revenue; fy2024=3,60,00,000; fy2025=4,10,00,000',
    'Row 2: metric=net_profit; fy2024=(empty); fy2025=24,00,000',
  ].join('\n');

  it('combines the row label with each period column', () => {
    const facts = extractFactsFromText(csv);
    const revenue = facts.find((f) => f.key === 'revenue_fy2025');
    expect(revenue?.value).toBe('4,10,00,000');
    expect(revenue?.normalizedValue).toBe('41000000');
    expect(facts.find((f) => f.key === 'revenue_fy2024')?.value).toBe('3,60,00,000');
  });

  it('quotes the whole row in the snippet, so the metric name is visible', () => {
    const revenue = extractFactsFromText(csv).find((f) => f.key === 'revenue_fy2025');
    expect(revenue?.sourceSnippet).toBe('Row 1: metric=revenue; fy2024=3,60,00,000; fy2025=4,10,00,000');
    expect(csv).toContain(revenue?.sourceSnippet ?? '');
  });

  it('skips empty cells and does not emit the row label as a fact', () => {
    const keys = extractFactsFromText(csv).map((f) => f.key);
    expect(keys).not.toContain('metric');
    expect(keys).not.toContain('revenue_fy2024_empty');
    expect(keys).toContain('net_profit_fy2025');
  });

  it('leaves a plain CSV (no row-label column) keyed by its column names', () => {
    const plain = ['Columns: name, address', 'Row 1: name=Jane Doe; address=12 High St'].join('\n');
    const keys = extractFactsFromText(plain).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['name', 'address']));
  });
});

describe('normalizeForComparison', () => {
  it('ignores Indian digit grouping and the currency code', () => {
    expect(normalizeForComparison('INR 4,80,00,000')).toBe(normalizeForComparison('INR 48000000'));
    expect(normalizeForComparison('INR 4,80,00,000')).not.toBe(normalizeForComparison('INR 3,95,00,000'));
  });

  it('treats company suffix variants as the same name', () => {
    expect(normalizeForComparison('Nimbus Agro Foods Pvt Ltd')).toBe(
      normalizeForComparison('Nimbus Agro Foods Private Limited'),
    );
  });

  it('still reports different names as different', () => {
    expect(normalizeForComparison('Rohan Mehta')).not.toBe(normalizeForComparison('Rohan Mehra'));
  });
});
