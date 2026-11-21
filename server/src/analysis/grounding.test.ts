import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnalysisResultSchema,
  type CrossDocumentAnalysisOutput,
  type ExtractedFact,
} from '@mdw/shared';
import { createTestApp } from '../testing/testApp.js';
import { insertProcessed } from '../testing/documents.js';
import { createMockProvider } from '../llm/mockProvider.js';
import { readFactsPayload, SCHEMA_NAMES } from '../llm/prompts.js';
import type { LLMProvider, StructuredRequest, StructuredResult } from '../llm/types.js';
import type { FindingDraft } from './comparison.js';
import { groundModelFindings, type GroundingContext } from './grounding.js';

/*
 * Reproduces the bug found in browser testing with a real model: a finding said application_form.pdf states
 * "Rohan Mehra", but the fact extracted from that document is "Rohan Mehta". The ids were all valid, so the
 * id guards passed it. Value grounding must not.
 */

const FORM = { documentId: randomUUID(), originalName: 'application_form.pdf' };
const LETTER = { documentId: randomUUID(), originalName: 'supporting_letter.txt' };

function fact(doc: { documentId: string }, key: string, value: string): ExtractedFact {
  return {
    id: randomUUID(),
    documentId: doc.documentId,
    key,
    value,
    normalizedValue: null,
    category: 'identity',
    sourceSnippet: `${key}: ${value}`,
    confidence: 0.9,
  };
}

function context(facts: ExtractedFact[], coveredKeys: string[] = []): GroundingContext {
  return {
    factById: new Map(facts.map((f) => [f.id, f])),
    documentNames: new Map([
      [FORM.documentId, FORM.originalName],
      [LETTER.documentId, LETTER.originalName],
    ]),
    factKeys: new Map(),
    coveredKeys: new Set(coveredKeys),
  };
}

function draft(overrides: Partial<FindingDraft> & Pick<FindingDraft, 'sources'>): FindingDraft {
  return {
    type: 'discrepancy',
    title: 'Applicant Name Discrepancy',
    description: 'Names differ.',
    severity: 'high',
    ...overrides,
  };
}

describe('groundModelFindings', () => {
  const formName = fact(FORM, 'applicant_name', 'Rohan Mehta');
  const letterName = fact(LETTER, 'applicant', 'Rohan Mehra');

  it('rewrites a finding whose text swaps the values, using the cited facts', () => {
    const hallucinated = draft({
      // The model attached the values to the wrong documents.
      description: 'application_form.pdf states "Rohan Mehra" while supporting_letter.txt states "Rohan Mehta".',
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: letterName.id, snippet: null },
      ],
    });

    const { kept, warnings } = groundModelFindings([hallucinated], context([formName, letterName]));

    expect(kept).toHaveLength(1);
    const finding = kept[0];
    expect(finding?.description).toContain('application_form.pdf: "Rohan Mehta"');
    expect(finding?.description).toContain('supporting_letter.txt: "Rohan Mehra"');
    expect(finding?.description).not.toContain('application_form.pdf states');
    // The quoted snippets come from the facts, not from the model.
    expect(finding?.sources.map((s) => s.snippet)).toEqual(['applicant_name: Rohan Mehta', 'applicant: Rohan Mehra']);
    expect(warnings.some((w) => w.includes('rewritten from the facts'))).toBe(true);
  });

  it('keeps wording that already matches, without a warning', () => {
    const accurate = draft({
      description: 'The form lists Rohan Mehta and the letter lists Rohan Mehra.',
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: letterName.id, snippet: null },
      ],
    });
    const { kept, warnings } = groundModelFindings([accurate], context([formName, letterName]));
    expect(kept).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('drops a discrepancy whose source does not cite a specific fact', () => {
    const vague = draft({
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: null, snippet: null },
      ],
    });
    const { kept, warnings } = groundModelFindings([vague], context([formName, letterName]));
    expect(kept).toEqual([]);
    expect(warnings[0]).toContain('does not cite a specific extracted fact');
  });

  it('drops a discrepancy when the cited values actually agree', () => {
    const sameName = fact(LETTER, 'applicant', 'Rohan Mehta');
    const claim = draft({
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: sameName.id, snippet: null },
      ],
    });
    const { kept, warnings } = groundModelFindings([claim], context([formName, sameName]));
    expect(kept).toEqual([]);
    expect(warnings[0]).toContain('do not differ');
  });

  it('drops a comparison ("they match") when the cited values differ', () => {
    const claim = draft({
      type: 'comparison',
      severity: null,
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: letterName.id, snippet: null },
      ],
    });
    const { kept, warnings } = groundModelFindings([claim], context([formName, letterName]));
    expect(kept).toEqual([]);
    expect(warnings[0]).toContain('do not agree');
  });

  it('drops a finding that compares facts about different fields', () => {
    const company = fact(LETTER, 'company', 'Nimbus Agro Foods');
    const claim = draft({
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: company.id, snippet: null },
      ],
    });
    const { kept, warnings } = groundModelFindings([claim], context([formName, company]));
    expect(kept).toEqual([]);
    expect(warnings[0]).toContain('different fields');
  });

  it('drops a finding that cites only one document', () => {
    const second = fact(FORM, 'applicant_name', 'Rohan M');
    const claim = draft({
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: FORM.documentId, factId: second.id, snippet: null },
      ],
    });
    const { kept } = groundModelFindings([claim], context([formName, second]));
    expect(kept).toEqual([]);
  });

  it('drops, without a warning, a finding the facts-based comparison already reports', () => {
    const duplicate = draft({
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: letterName.id, snippet: null },
      ],
    });
    const { kept, warnings } = groundModelFindings([duplicate], context([formName, letterName], ['applicant_name']));
    expect(kept).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('does not count a "not recorded" statement as a value', () => {
    const absent = fact(LETTER, 'applicant', 'Not provided');
    const claim = draft({
      sources: [
        { documentId: FORM.documentId, factId: formName.id, snippet: null },
        { documentId: LETTER.documentId, factId: absent.id, snippet: null },
      ],
    });
    const { kept, warnings } = groundModelFindings([claim], context([formName, absent]));
    expect(kept).toEqual([]);
    expect(warnings[0]).toContain('fewer than two');
  });

  it('leaves other finding types alone', () => {
    const point = draft({
      type: 'summary_point',
      title: 'Licence may have expired',
      description: 'The letter gives 31-03-2026, which has passed.',
      sources: [{ documentId: LETTER.documentId, factId: null, snippet: null }],
    });
    const { kept, warnings } = groundModelFindings([point], context([]));
    expect(kept).toEqual([point]);
    expect(warnings).toEqual([]);
  });
});

/*
 * The same bug through the whole engine: a provider that returns a hallucinated cross-document output.
 */
describe('analysis engine with a hallucinating model', () => {
  let ctx: ReturnType<typeof createTestApp>;

  afterEach(() => {
    ctx.close();
  });

  const FORM_TEXT = ['Applicant: Rohan Mehta', 'Company: Nimbus Agro Foods Pvt Ltd', 'Tenure: 5 years'].join('\n');
  const LETTER_TEXT = ['Applicant: Rohan Mehra', 'Company: Nimbus Agro Foods Private Limited', 'Tenure: 5 years'].join('\n');

  /** Extraction is the mock. The cross-document reply is wrong in several ways. */
  function hallucinatingProvider(): LLMProvider {
    const inner = createMockProvider();
    return {
      name: 'mock',
      async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        if (req.schemaName !== SCHEMA_NAMES.crossDocument) return inner.generateStructured(req);

        const payload = readFactsPayload(req.user);
        if (!payload) throw new Error('test setup: no facts payload');
        const docOf = (name: string) => payload.documents.find((d) => d.originalName === name);
        const form = docOf('application_form.pdf');
        const letter = docOf('supporting_letter.txt');
        const factOf = (doc: typeof form, key: string) => doc?.facts.find((f) => f.key === key);
        if (!form || !letter) throw new Error('test setup: documents missing');

        const applicantForm = factOf(form, 'applicant');
        const applicantLetter = factOf(letter, 'applicant');
        const tenureForm = factOf(form, 'tenure');
        const tenureLetter = factOf(letter, 'tenure');
        if (!applicantForm || !applicantLetter || !tenureForm || !tenureLetter) throw new Error('test setup: facts missing');

        const output: CrossDocumentAnalysisOutput = {
          findings: [
            {
              // Right documents and valid fact ids, but the values are attached to the wrong documents.
              type: 'discrepancy',
              title: 'Applicant name mismatch',
              description: 'application_form.pdf states "Rohan Mehra" while supporting_letter.txt states "Rohan Mehta".',
              severity: 'high',
              sources: [
                { documentId: form.documentId, factId: applicantForm.id, snippet: 'Applicant: Rohan Mehra' },
                { documentId: letter.documentId, factId: applicantLetter.id, snippet: 'Applicant: Rohan Mehta' },
              ],
            },
            {
              // A discrepancy with no fact behind it.
              type: 'discrepancy',
              title: 'Licence mismatch',
              description: 'The licence numbers differ.',
              severity: 'medium',
              sources: [
                { documentId: form.documentId, factId: null, snippet: null },
                { documentId: letter.documentId, factId: null, snippet: null },
              ],
            },
            {
              // A true match, described with a wrong value. Not covered by the facts-based comparison.
              type: 'comparison',
              title: 'Tenure matches',
              description: 'Both documents say the tenure is 6 years.',
              severity: null,
              sources: [
                { documentId: form.documentId, factId: tenureForm.id, snippet: null },
                { documentId: letter.documentId, factId: tenureLetter.id, snippet: null },
              ],
            },
            {
              type: 'summary_point',
              title: 'Check the letter date',
              description: 'The supporting letter should be dated before the application.',
              severity: 'low',
              sources: [{ documentId: letter.documentId, factId: null, snippet: null }],
            },
          ],
          // Neither of these may be used: the table and the missing items are computed from the facts.
          missingInformation: [
            {
              type: 'missing_information',
              title: 'Invented gap',
              description: 'Something the model made up.',
              severity: 'high',
              sources: [{ documentId: form.documentId, factId: null, snippet: null }],
            },
          ],
          comparisonTable: {
            columns: [form.documentId, letter.documentId],
            rows: [{ field: 'invented_row', values: { [form.documentId]: 'x', [letter.documentId]: 'y' }, consistent: true }],
          },
          // The model quotes ids instead of names, as a real model did in browser testing.
          summary: `Model-written summary: ${form.documentId.slice(0, 8)} differs from ${letter.documentId}.`,
        };
        return { data: req.schema.parse(output) };
      },
    };
  }

  it('never lets a wrong value through, and keeps the facts-based results', async () => {
    ctx = createTestApp({ provider: hallucinatingProvider() });
    const form = insertProcessed(ctx, 'application_form.pdf', FORM_TEXT);
    const letter = insertProcessed(ctx, 'supporting_letter.txt', LETTER_TEXT);

    const result = AnalysisResultSchema.parse(
      await ctx.analysisService.run({ documentIds: [form, letter], instruction: 'Highlight discrepancies in names' }),
    );
    expect(result.status).toBe('completed');

    // The applicant discrepancy comes from the facts, with each document's own value, and appears once.
    const applicant = result.findings.filter((f) => f.type === 'discrepancy' && f.title.startsWith('Applicant'));
    expect(applicant).toHaveLength(1);
    expect(applicant[0]?.description).toContain('application_form.pdf: "Rohan Mehta"');
    expect(applicant[0]?.description).toContain('supporting_letter.txt: "Rohan Mehra"');

    // Nothing the model wrote about a wrong value survived anywhere.
    const everyText = [...result.findings, ...result.missingInformation].map((f) => `${f.title} ${f.description}`).join('\n');
    expect(everyText).not.toContain('application_form.pdf states "Rohan Mehra"');
    expect(everyText).not.toContain('6 years');

    // The match with a wrong value is kept, but rewritten from the facts and flagged.
    const tenure = result.findings.find((f) => f.type === 'comparison' && f.title.startsWith('Tenure'));
    expect(tenure?.description).toContain('application_form.pdf: "5 years"');
    expect(result.warnings.some((w) => w.includes('Tenure matches') && w.includes('rewritten from the facts'))).toBe(true);

    // The discrepancy with no fact behind it was dropped, with a warning.
    expect(result.findings.some((f) => f.title === 'Licence mismatch')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Licence mismatch') && w.includes('does not cite a specific extracted fact'))).toBe(true);

    // A summary point is free interpretation and passes through the id guards only.
    expect(result.findings.some((f) => f.type === 'summary_point' && f.title === 'Check the letter date')).toBe(true);

    // Missing information and the table come from code, not from the model.
    expect(result.missingInformation.some((f) => f.title === 'Invented gap')).toBe(false);
    expect(result.comparisonTable?.rows.some((r) => r.field === 'invented_row')).toBe(false);
    expect(result.comparisonTable?.rows.some((r) => r.field === 'Applicant / director name')).toBe(true);

    // The model still writes the summary.
    // The model still writes the summary. Any document id it quoted is shown as the document's name.
    expect(result.summary).toBe('Model-written summary: application_form.pdf differs from supporting_letter.txt.');
  });

  it('falls back to a summary built from the verified comparison when the model gives none', async () => {
    const inner = createMockProvider();
    const noSummary: LLMProvider = {
      name: 'mock',
      async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        const result = await inner.generateStructured(req);
        if (req.schemaName !== SCHEMA_NAMES.crossDocument) return result;
        return { data: req.schema.parse({ ...(result.data as object), summary: null }) };
      },
    };
    ctx = createTestApp({ provider: noSummary });
    const form = insertProcessed(ctx, 'application_form.pdf', FORM_TEXT);
    const letter = insertProcessed(ctx, 'supporting_letter.txt', LETTER_TEXT);

    const result = await ctx.analysisService.run({ documentIds: [form, letter], instruction: 'Compare the documents' });
    expect(result.summary).toContain('Compared 2 documents.');
    expect(result.summary).toContain('Applicant / director name');
  });
});
