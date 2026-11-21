import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describeComparison, replaceDocumentIds } from './summary.js';

describe('replaceDocumentIds', () => {
  const form = { documentId: randomUUID(), originalName: 'application_form.pdf' };
  const letter = { documentId: randomUUID(), originalName: 'supporting_letter.txt' };
  const docs = [form, letter];

  it('replaces a full document id with the file name', () => {
    expect(replaceDocumentIds(`See ${form.documentId} for details.`, docs)).toBe('See application_form.pdf for details.');
  });

  it('replaces the eight-character id that models like to quote', () => {
    const short = form.documentId.slice(0, 8);
    const text = `'Rohan Mehta' appears in documents ${short} and ${letter.documentId.slice(0, 8)}.`;
    expect(replaceDocumentIds(text, docs)).toBe(
      "'Rohan Mehta' appears in documents application_form.pdf and supporting_letter.txt.",
    );
  });

  it('matches case-insensitively', () => {
    expect(replaceDocumentIds(`in ${form.documentId.slice(0, 8).toUpperCase()}.`, docs)).toBe('in application_form.pdf.');
  });

  it('does not touch longer words that merely start with the same characters', () => {
    const short = form.documentId.slice(0, 8);
    expect(replaceDocumentIds(`${short}beef is not an id`, docs)).toBe(`${short}beef is not an id`);
  });

  it('leaves text without ids unchanged', () => {
    expect(replaceDocumentIds('Revenue differs between the documents.', docs)).toBe(
      'Revenue differs between the documents.',
    );
  });
});

describe('describeComparison', () => {
  it('lists discrepancies and gaps, with correct singular and plural forms', () => {
    const text = describeComparison({
      documentCount: 3,
      discrepancies: ['Revenue FY2025'],
      missing: ['Co-director', 'Licence number'],
      consistentCount: 1,
    });
    expect(text).toBe(
      'Compared 3 documents. 1 discrepancy found: Revenue FY2025. 2 important fields are missing from at least one document: Co-director, Licence number. 1 field agree across the documents that state them.',
    );
  });

  it('says so plainly when nothing differs and nothing is missing', () => {
    const text = describeComparison({ documentCount: 2, discrepancies: [], missing: [], consistentCount: 4 });
    expect(text).toContain('No discrepancies were found.');
    expect(text).toContain('No important fields are missing.');
  });

  it('shortens a long list', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `Field ${i + 1}`);
    const text = describeComparison({ documentCount: 2, discrepancies: labels, missing: [], consistentCount: 0 });
    expect(text).toContain('and 4 more');
  });
});
