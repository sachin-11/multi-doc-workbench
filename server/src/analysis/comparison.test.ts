import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExtractedFact } from '@mdw/shared';
import { compareFacts } from './comparison.js';
import { inferDocTypeFromName } from './docTypes.js';

/*
 * The comparison is deterministic code. These tests pin down what it reports and, as important, what it
 * does not: formatting differences are not discrepancies, "not recorded" is a gap and not a value, and
 * every document that has a field is cited.
 */

const FORM = { documentId: randomUUID(), originalName: 'application_form.pdf' };
const LETTER = { documentId: randomUUID(), originalName: 'supporting_letter.txt' };
const CSV = { documentId: randomUUID(), originalName: 'financials.csv' };
const KYC = { documentId: randomUUID(), originalName: 'kyc_summary.txt' };

function fact(doc: { documentId: string }, key: string, value: string, category: ExtractedFact['category'] = 'other'): ExtractedFact {
  return {
    id: randomUUID(),
    documentId: doc.documentId,
    key,
    value,
    normalizedValue: null,
    category,
    sourceSnippet: `${key}: ${value}`,
    confidence: 0.9,
  };
}

function run(entries: Array<[typeof FORM, ExtractedFact[]]>) {
  const docs = entries.map(([doc]) => doc);
  const facts = new Map(entries.map(([doc, list]) => [doc.documentId, list]));
  return compareFacts(docs, facts);
}

const title = (f: { title: string }) => f.title;

describe('discrepancies', () => {
  it('includes ALL documents that state the field, with every value', () => {
    const result = run([
      [FORM, [fact(FORM, 'annual_revenue_2025', 'INR 4,80,00,000', 'financial')]],
      [LETTER, [fact(LETTER, 'revenue_fy2025', 'INR 3,95,00,000', 'financial')]],
      [CSV, [fact(CSV, 'revenue_fy2025', '4,10,00,000', 'financial')]],
    ]);

    const revenue = result.findings.find((f) => f.type === 'discrepancy');
    expect(revenue?.title).toBe('Revenue FY2025 differs between documents');
    expect(new Set(revenue?.sources.map((s) => s.documentId))).toEqual(
      new Set([FORM.documentId, LETTER.documentId, CSV.documentId]),
    );
    for (const value of ['INR 4,80,00,000', 'INR 3,95,00,000', '4,10,00,000']) {
      expect(revenue?.description).toContain(value);
    }
    expect(revenue?.severity).toBe('high');
  });

  it('pairs each document with its own value in the description', () => {
    const result = run([
      [FORM, [fact(FORM, 'applicant_name', 'Rohan Mehta', 'identity')]],
      [LETTER, [fact(LETTER, 'applicant', 'Rohan Mehra', 'identity')]],
    ]);
    const finding = result.findings[0];
    expect(finding?.description).toContain('application_form.pdf: "Rohan Mehta"');
    expect(finding?.description).toContain('supporting_letter.txt: "Rohan Mehra"');
  });

  it('compares values across synonym keys (director_name against applicant_name)', () => {
    const result = run([
      [FORM, [fact(FORM, 'applicant_name', 'Rohan Mehta', 'identity')]],
      [KYC, [fact(KYC, 'director_name', 'Rohan Mehra', 'identity')]],
    ]);
    expect(result.findings.map(title)).toEqual(['Applicant / director name differs between documents']);
  });

  it('does not report a difference that is only formatting', () => {
    const result = run([
      [FORM, [fact(FORM, 'revenue_fy2025', 'INR 4,80,00,000', 'financial'), fact(FORM, 'licence_expiry', '31-03-2027', 'date')]],
      [LETTER, [fact(LETTER, 'revenue_fy2025', '4.8 crore', 'financial'), fact(LETTER, 'licence_expiry', '2027-03-31', 'date')]],
    ]);
    expect(result.findings.filter((f) => f.type === 'discrepancy')).toEqual([]);
    expect(result.comparisonTable.rows.every((row) => row.consistent === true)).toBe(true);
  });

  it('marks a field that only one document states as single source (consistent: null)', () => {
    const result = run([
      [FORM, [fact(FORM, 'loan_amount', 'INR 75,00,000'), fact(FORM, 'applicant_name', 'Rohan Mehta', 'identity')]],
      [LETTER, [fact(LETTER, 'applicant', 'Rohan Mehta', 'identity')]],
    ]);
    const rows = Object.fromEntries(result.comparisonTable.rows.map((r) => [r.field, r.consistent]));
    expect(rows['Loan']).toBeNull();
    expect(rows['Applicant / director name']).toBe(true);
  });

  it('reports a company suffix variant as a low-severity match, not a discrepancy', () => {
    const result = run([
      [FORM, [fact(FORM, 'company', 'Nimbus Agro Foods Pvt Ltd', 'identity')]],
      [KYC, [fact(KYC, 'company_name', 'Nimbus Agro Foods Private Limited', 'identity')]],
    ]);
    expect(result.findings.some((f) => f.type === 'discrepancy')).toBe(false);
    const match = result.findings.find((f) => f.type === 'comparison');
    expect(match?.severity).toBe('low');
    expect(match?.description).toContain('once formatting is ignored');
  });

  it('does not treat a document that lists an extra person as disagreeing', () => {
    const result = run([
      [FORM, [fact(FORM, 'applicant_name', 'Rohan Mehta', 'identity'), fact(FORM, 'director', 'Ananya Rao', 'identity')]],
      [KYC, [fact(KYC, 'director', 'Ananya Rao', 'identity')]],
    ]);
    expect(result.findings.some((f) => f.type === 'discrepancy')).toBe(false);
  });

  it('never compares generated positional keys', () => {
    const result = run([
      [FORM, [fact(FORM, 'amount_1', 'INR 100', 'financial')]],
      [LETTER, [fact(LETTER, 'amount_1', 'INR 999', 'financial')]],
    ]);
    expect(result.findings).toEqual([]);
    expect(result.comparisonTable.rows).toEqual([]);
  });
});

describe('missing information', () => {
  it('reports an important field present in some documents and absent from others', () => {
    const result = run([
      [FORM, [fact(FORM, 'co_director', 'Ananya Kapoor', 'identity'), fact(FORM, 'licence', 'FSL-1', 'licence')]],
      [LETTER, [fact(LETTER, 'licence_no', 'FSL-1', 'licence')]],
      [KYC, [fact(KYC, 'company', 'Nimbus', 'identity')]],
    ]);
    const titles = result.missingInformation.map(title);
    // A supporting letter is not expected to name a co-director, so only the KYC summary is a gap.
    expect(titles).toContain('Co-director is missing from kyc_summary.txt');
    expect(titles).toContain('Licence number is missing from kyc_summary.txt');
    // The document that states it and the expected-but-missing one are cited, the absent one without a fact.
    const coDirector = result.missingInformation.find((f) => f.title.startsWith('Co-director'));
    expect(coDirector?.sources.map((s) => s.documentId)).toEqual([FORM.documentId, KYC.documentId]);
    expect(coDirector?.sources[0]?.factId).not.toBeNull();
    expect(coDirector?.sources[1]?.factId).toBeNull();
  });

  it('only reports a field as missing from document types that are expected to contain it', () => {
    const result = run([
      [FORM, [fact(FORM, 'applicant_name', 'Rohan Mehta', 'identity'), fact(FORM, 'company', 'Nimbus', 'identity'), fact(FORM, 'revenue_fy2025', '4,80,00,000', 'financial')]],
      [CSV, [fact(CSV, 'metric', 'x')]],
    ]);
    const titles = result.missingInformation.map(title);
    // A financials CSV is not expected to carry names, but it is expected to carry revenue.
    expect(titles.some((t) => t.startsWith('Applicant'))).toBe(false);
    expect(titles.some((t) => t.startsWith('Company name'))).toBe(false);
    expect(titles).toContain('Revenue FY2025 is missing from financials.csv');
  });

  it('assigns severity by field: high for licence, revenue and applicant name, medium for address and co-director', () => {
    const result = run([
      [FORM, [
        fact(FORM, 'licence', 'FSL-1', 'licence'),
        fact(FORM, 'address', '14 Lotus Park, Sector 21', 'address'),
        fact(FORM, 'co_director', 'Ananya Kapoor', 'identity'),
        fact(FORM, 'applicant_name', 'Rohan Mehta', 'identity'),
      ]],
      [LETTER, [fact(LETTER, 'address', '14 Lotus Park, Sector 12', 'address'), fact(LETTER, 'applicant', 'Rohan Mehra', 'identity')]],
      [KYC, [fact(KYC, 'company', 'Nimbus', 'identity')]],
    ]);
    const missing = (prefix: string) => result.missingInformation.find((f) => f.title.startsWith(prefix))?.severity;
    expect(missing('Licence number')).toBe('high');
    expect(missing('Co-director')).toBe('medium');
    expect(missing('Applicant')).toBe('high');
    const difference = (prefix: string) => result.findings.find((f) => f.title.startsWith(prefix))?.severity;
    expect(difference('Registered address')).toBe('medium');
    expect(difference('Applicant')).toBe('high');
  });

  it('infers the document type from the file name', () => {
    expect(inferDocTypeFromName('application_form.pdf')).toBe('application_form');
    expect(inferDocTypeFromName('supporting_letter.txt')).toBe('supporting_letter');
    expect(inferDocTypeFromName('financials_fy2025.csv')).toBe('financials');
    expect(inferDocTypeFromName('kyc_summary.txt')).toBe('kyc');
    expect(inferDocTypeFromName('mystery.txt')).toBeNull();
  });

  it('counts "No revenue figure is recorded" as missing, never as a value', () => {
    const result = run([
      [FORM, [fact(FORM, 'revenue_fy2025', 'INR 4,80,00,000', 'financial')]],
      [LETTER, [fact(LETTER, 'revenue_fy2025', 'INR 4,80,00,000', 'financial')]],
      [KYC, [fact(KYC, 'revenue_figure', 'No revenue figure is recorded in this summary.', 'financial')]],
    ]);

    // Not a discrepancy: the KYC summary gives no value to disagree with.
    expect(result.findings.some((f) => f.type === 'discrepancy')).toBe(false);
    const missing = result.missingInformation.find((f) => f.title.startsWith('Revenue FY2025'));
    expect(missing?.title).toBe('Revenue FY2025 is missing from kyc_summary.txt');
    // The statement of absence is quoted, and cited with its own fact.
    expect(missing?.description).toContain('No revenue figure is recorded');
    const kycSource = missing?.sources.find((s) => s.documentId === KYC.documentId);
    expect(kycSource?.factId).not.toBeNull();
    // The table shows no value for the KYC document.
    const row = result.comparisonTable.rows.find((r) => r.field === 'Revenue FY2025');
    expect(row?.values[KYC.documentId]).toBeNull();
  });

  it('ignores fields that are not important', () => {
    const result = run([
      [FORM, [fact(FORM, 'tenure', '5 years'), fact(FORM, 'loan_amount_requested', 'INR 75,00,000', 'financial')]],
      [LETTER, [fact(LETTER, 'applicant_name', 'Rohan Mehta', 'identity')]],
    ]);
    expect(result.missingInformation.map(title)).toEqual(['Applicant / director name is missing from application_form.pdf']);
  });

  it('does not report a prior-year figure that only one document carries', () => {
    const result = run([
      [FORM, [fact(FORM, 'revenue_fy2025', '100', 'financial')]],
      [LETTER, [fact(LETTER, 'revenue_fy2025', '100', 'financial')]],
      [CSV, [fact(CSV, 'revenue_fy2025', '100', 'financial'), fact(CSV, 'revenue_fy2024', '90', 'financial')]],
    ]);
    expect(result.missingInformation).toEqual([]);
  });

  it('attaches a revenue figure without a period to the period that several documents state', () => {
    const result = run([
      [FORM, [fact(FORM, 'revenue_fy2025', 'INR 100', 'financial')]],
      [LETTER, [fact(LETTER, 'revenue_figure', 'INR 120', 'financial')]],
      [CSV, [fact(CSV, 'revenue_fy2025', 'INR 100', 'financial'), fact(CSV, 'revenue_fy2024', 'INR 90', 'financial')]],
    ]);
    const finding = result.findings.find((f) => f.type === 'discrepancy');
    expect(finding?.title).toBe('Revenue FY2025 differs between documents');
    expect(finding?.sources.map((s) => s.documentId)).toContain(LETTER.documentId);
  });
});

describe('comparison table', () => {
  it('has every document as a column, and a null cell where a document does not state the field', () => {
    const result = run([
      [FORM, [fact(FORM, 'address', '14 Lotus Park', 'address')]],
      [LETTER, [fact(LETTER, 'address', '14 Lotus Park', 'address')]],
      [CSV, [fact(CSV, 'net_profit_fy2025', '24,00,000', 'financial')]],
    ]);
    expect(result.comparisonTable.columns).toEqual([FORM.documentId, LETTER.documentId, CSV.documentId]);
    const address = result.comparisonTable.rows.find((r) => r.field === 'Registered address');
    expect(address?.values[CSV.documentId]).toBeNull();
    expect(address?.consistent).toBe(true);
  });

  it('lists important fields first', () => {
    const result = run([
      [FORM, [fact(FORM, 'tenure', '5 years'), fact(FORM, 'applicant_name', 'A', 'identity')]],
      [LETTER, [fact(LETTER, 'tenure', '5 years'), fact(LETTER, 'applicant_name', 'A', 'identity')]],
    ]);
    expect(result.comparisonTable.rows.map((r) => r.field)).toEqual(['Applicant / director name', 'Tenure']);
  });
});

describe('verified results for the prompt', () => {
  it('summarises discrepancies, gaps and agreements, and a fallback summary says the same', () => {
    const result = run([
      [FORM, [fact(FORM, 'revenue_fy2025', '100', 'financial'), fact(FORM, 'address', 'X', 'address')]],
      [LETTER, [fact(LETTER, 'revenue_fy2025', '200', 'financial')]],
    ]);
    expect(result.verified.discrepancies.map((d) => d.field)).toEqual(['Revenue FY2025']);
    expect(result.verified.missing.map((m) => m.field)).toEqual(['Registered address']);
    expect(result.fallbackSummary).toContain('Compared 2 documents.');
    expect(result.fallbackSummary).toContain('Revenue FY2025');
    expect(result.fallbackSummary).toContain('Registered address');
  });
});
