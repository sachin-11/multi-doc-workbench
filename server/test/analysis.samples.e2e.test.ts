/*
 * FLAGSHIP TEST: end-to-end provenance on the committed sample documents.
 *
 * Why this test matters: the brief's core requirements are (1) analyse documents per document first,
 * never as one merged blob, and (2) every finding cites the documents that support it. This test drives
 * the real HTTP path (multipart upload, background processing, analysis, markdown export) on the four
 * synthetic files in samples/ and checks those properties end to end:
 *   - document boundaries survive: each document gets its own facts, and each fact points at its own
 *     document and quotes text that really exists in that document;
 *   - every finding cites only uploaded documents, and never an unknown id;
 *   - the planted discrepancies (revenue, applicant name) are found and cite the right documents.
 * Unit tests cover each guard in isolation. This one shows that they hold together in the running flow.
 *
 * Offline: MOCK provider, in-memory SQLite, no network (see test/setup.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  AnalysisResultSchema,
  DocumentTextResponseSchema,
  UploadResponseSchema,
  type AnalysisResult,
  type DocumentMeta,
  type Finding,
} from '@mdw/shared';
import { createTestApp } from '../src/testing/testApp.js';
import { waitForProcessing } from './helpers.js';

const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples');
const INSTRUCTION = 'Highlight discrepancies in names, addresses, licence details, or revenue figures';

const VALID_SAMPLES = [
  { name: 'application_form.pdf', contentType: 'application/pdf' },
  { name: 'supporting_letter.txt', contentType: 'text/plain' },
  { name: 'financials_fy2025.csv', contentType: 'text/csv' },
  { name: 'kyc_summary.txt', contentType: 'text/plain' },
] as const;

const INVALID_SAMPLES = [
  { name: 'invalid_samples/fake.pdf', contentType: 'application/pdf', code: 'SIGNATURE_MISMATCH' },
  { name: 'invalid_samples/empty.txt', contentType: 'text/plain', code: 'EMPTY_FILE' },
  { name: 'invalid_samples/script.exe', contentType: 'application/x-msdownload', code: 'UNSUPPORTED_EXTENSION' },
  {
    name: 'invalid_samples/notes.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    code: 'UNSUPPORTED_EXTENSION',
  },
] as const;

function readSample(relative: string): Buffer {
  return fs.readFileSync(path.join(SAMPLES_DIR, relative));
}

/** Collapses whitespace so a quote that wraps across lines still matches the extracted text. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findByPrefix(findings: Finding[], type: Finding['type'], titlePrefix: string): Finding | undefined {
  return findings.find((f) => f.type === type && f.title.startsWith(titlePrefix));
}

describe('end-to-end provenance on samples/ (HTTP, MOCK provider)', () => {
  const ctx = createTestApp();
  let docs: Record<string, DocumentMeta>;
  let analysis: AnalysisResult;
  let markdown: string;
  // Extracted text per document id, read from GET /api/documents/:id/text.
  const textById = new Map<string, string>();

  beforeAll(async () => {
    // 1. Upload the four valid samples in one multipart request, as the UI does.
    let upload = request(ctx.app).post('/api/documents');
    for (const sample of VALID_SAMPLES) {
      upload = upload.attach('files', readSample(sample.name), {
        filename: sample.name,
        contentType: sample.contentType,
      });
    }
    const uploadRes = await upload;
    expect(uploadRes.status).toBe(200);
    const uploaded = UploadResponseSchema.parse(uploadRes.body);
    expect(uploaded.rejected).toEqual([]);
    expect(uploaded.accepted).toHaveLength(VALID_SAMPLES.length);
    docs = Object.fromEntries(uploaded.accepted.map((d) => [d.originalName, d]));

    // 2. Wait for background processing of every document to finish.
    for (const meta of uploaded.accepted) {
      const detail = await waitForProcessing(ctx.app, meta.id);
      expect(detail.status, `${meta.originalName} should be processed`).toBe('processed');
      const textRes = await request(ctx.app).get(`/api/documents/${meta.id}/text`);
      expect(textRes.status).toBe(200);
      textById.set(meta.id, DocumentTextResponseSchema.parse(textRes.body).text);
    }

    // 3. Run the analysis through the public endpoint.
    const analysisRes = await request(ctx.app)
      .post('/api/analyses')
      .send({ documentIds: uploaded.accepted.map((d) => d.id), instruction: INSTRUCTION });
    expect(analysisRes.status).toBe(200);
    analysis = AnalysisResultSchema.parse(analysisRes.body);

    // 4. Markdown export of the same analysis.
    const exportRes = await request(ctx.app).get(`/api/analyses/${analysis.id}/export?format=markdown`);
    expect(exportRes.status).toBe(200);
    markdown = exportRes.text;
  }, 30_000);

  afterAll(() => {
    ctx.close();
  });

  const documentIds = () => Object.values(docs).map((d) => d.id);

  it('processes all four documents', () => {
    expect(Object.keys(docs).sort()).toEqual(VALID_SAMPLES.map((s) => s.name).sort());
    for (const id of documentIds()) {
      expect(textById.get(id)?.length ?? 0).toBeGreaterThan(0);
    }
    expect(analysis.status).toBe('completed');
  });

  it('keeps document boundaries: each document has its own facts, and every fact names its document', () => {
    for (const meta of Object.values(docs)) {
      const facts = analysis.perDocumentFacts[meta.id] ?? [];
      expect(facts.length, `${meta.originalName} should have facts`).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(fact.documentId).toBe(meta.id);
      }
    }
    // Nothing is stored under an id that was not uploaded in this run.
    expect(Object.keys(analysis.perDocumentFacts).sort()).toEqual([...documentIds()].sort());
  });

  it("every fact's sourceSnippet is found in its own document's extracted text", () => {
    for (const [documentId, facts] of Object.entries(analysis.perDocumentFacts)) {
      const ownText = squash(textById.get(documentId) ?? '');
      for (const fact of facts) {
        expect(
          ownText.includes(squash(fact.sourceSnippet)),
          `fact ${fact.key} quotes text that is not in its document: "${fact.sourceSnippet}"`,
        ).toBe(true);
      }
    }
  });

  it('finds the revenue discrepancy with ALL documents that state revenue, and all three values', () => {
    const revenue = findByPrefix(analysis.findings, 'discrepancy', 'Revenue FY2025');
    expect(revenue, 'revenue discrepancy').toBeDefined();
    const cited = new Set(revenue?.sources.map((s) => s.documentId));
    for (const name of ['application_form.pdf', 'supporting_letter.txt', 'financials_fy2025.csv']) {
      expect(cited.has(docs[name]?.id ?? ''), `${name} should be cited`).toBe(true);
    }
    // The KYC summary states no revenue ("No revenue figure is recorded"), so it is a gap, not a source of a value.
    expect(cited.has(docs['kyc_summary.txt']?.id ?? '')).toBe(false);
    for (const value of ['4,80,00,000', '3,95,00,000', '4,10,00,000']) {
      expect(revenue?.description, `revenue value ${value}`).toContain(value);
    }
  });

  it('finds the applicant name discrepancy and pairs each document with its OWN value (Mehta vs Mehra)', () => {
    const name = findByPrefix(analysis.findings, 'discrepancy', 'Applicant');
    expect(name, 'applicant name discrepancy').toBeDefined();
    expect(name?.description).toContain('application_form.pdf: "Rohan Mehta"');
    expect(name?.description).toContain('supporting_letter.txt: "Rohan Mehra"');
    // The KYC summary lists the director as Rohan Mehta, so it is part of the same finding.
    expect(name?.description).toContain('kyc_summary.txt: "Rohan Mehta"');
    const cited = new Set(name?.sources.map((s) => s.documentId));
    expect(cited.has(docs['application_form.pdf']?.id ?? '')).toBe(true);
    expect(cited.has(docs['supporting_letter.txt']?.id ?? '')).toBe(true);
  });

  it('grounds every discrepancy: each cited document is paired with the value of its own cited fact', () => {
    const factById = new Map(Object.values(analysis.perDocumentFacts).flat().map((f) => [f.id, f]));
    const nameOf = (id: string) => Object.values(docs).find((d) => d.id === id)?.originalName ?? '';
    const discrepancies = analysis.findings.filter((f) => f.type === 'discrepancy');
    expect(discrepancies.length).toBeGreaterThanOrEqual(4);

    for (const finding of discrepancies) {
      for (const source of finding.sources) {
        const fact = factById.get(source.factId ?? '');
        expect(fact, `"${finding.title}": every source cites a fact`).toBeDefined();
        expect(fact?.documentId).toBe(source.documentId);
        const pattern = new RegExp(`${escapeRegExp(nameOf(source.documentId))}: [^;]*"${escapeRegExp(fact?.value ?? '')}"`);
        expect(finding.description, `"${finding.title}" must quote ${nameOf(source.documentId)}'s own value`).toMatch(pattern);
      }
    }
  });

  it('reports the co-director as missing from kyc_summary.txt, citing the form that states it', () => {
    const missing = analysis.missingInformation.find((f) => f.title.startsWith('Co-director'));
    expect(missing, 'co-director missing').toBeDefined();
    expect(missing?.title).toContain('kyc_summary.txt');
    const form = missing?.sources.find((s) => s.documentId === docs['application_form.pdf']?.id);
    expect(form?.factId, 'the form that states the co-director is cited with its fact').not.toBeNull();
  });

  it('reports the licence as missing from kyc_summary.txt only, not from the financials CSV', () => {
    const missing = analysis.missingInformation.find((f) => f.title.startsWith('Licence number'));
    expect(missing, 'licence missing').toBeDefined();
    expect(missing?.title).toContain('kyc_summary.txt');
    expect(missing?.title).not.toContain('financials_fy2025.csv');
    expect(missing?.severity).toBe('high');
  });

  it('is doc-type aware: the financials CSV is not reported as missing names, address or licence', () => {
    const csvName = 'financials_fy2025.csv';
    for (const finding of analysis.missingInformation) {
      expect(finding.title, `"${finding.title}"`).not.toContain(csvName);
    }
    // The co-director gap is medium; revenue missing from the KYC summary is high.
    expect(analysis.missingInformation.find((f) => f.title.startsWith('Co-director'))?.severity).toBe('medium');
    expect(analysis.missingInformation.find((f) => f.title.startsWith('Revenue FY2025'))?.severity).toBe('high');
  });

  it('applies the severity rules to discrepancies: licence, revenue and applicant high, address medium', () => {
    const severity = (prefix: string) => findByPrefix(analysis.findings, 'discrepancy', prefix)?.severity;
    expect(severity('Licence expiry date')).toBe('high');
    expect(severity('Revenue FY2025')).toBe('high');
    expect(severity('Applicant')).toBe('high');
    expect(severity('Registered address')).toBe('medium');
  });

  it('marks fields stated by a single document as single source in the table and the export', () => {
    const rows = analysis.comparisonTable?.rows ?? [];
    const single = rows.filter((r) => Object.values(r.values).filter((v) => v !== null).length === 1);
    expect(single.length, 'the sample set has single-source rows (loan amount, tenure)').toBeGreaterThan(0);
    for (const row of single) expect(row.consistent, row.field).toBeNull();
    for (const row of rows.filter((r) => Object.values(r.values).filter((v) => v !== null).length >= 2)) {
      expect(typeof row.consistent, row.field).toBe('boolean');
    }
    expect(markdown).toContain('single source');
  });

  it('does not report prior-year figures or unimportant fields as missing information', () => {
    const titles = analysis.missingInformation.map((f) => f.title);
    expect(titles.some((t) => t.startsWith('Revenue FY2024'))).toBe(false);
    expect(titles.some((t) => /cash|application_date|tenure/i.test(t))).toBe(false);
    // Important fields only: names, address, licence number and expiry, revenue, co-director.
    expect(analysis.missingInformation.length).toBeLessThanOrEqual(10);
  });

  it('builds the comparison table with every document as a column', () => {
    const table = analysis.comparisonTable;
    expect(table, 'comparison table').not.toBeNull();
    expect(new Set(table?.columns)).toEqual(new Set(documentIds()));
    const revenueRow = table?.rows.find((r) => r.field === 'Revenue FY2025');
    expect(revenueRow?.consistent).toBe(false);
    // Form, letter and CSV state a revenue. The KYC summary does not.
    expect(Object.values(revenueRow?.values ?? {}).filter((v) => v !== null)).toHaveLength(3);
    expect(revenueRow?.values[docs['kyc_summary.txt']?.id ?? '']).toBeNull();
  });

  it('reports at least one missing-information finding', () => {
    expect(analysis.missingInformation.length).toBeGreaterThan(0);
    for (const finding of analysis.missingInformation) {
      expect(finding.type).toBe('missing_information');
    }
  });

  it('cites only uploaded document ids, and every finding has at least one source', () => {
    const known = new Set(documentIds());
    for (const finding of [...analysis.findings, ...analysis.missingInformation]) {
      expect(finding.sources.length, `"${finding.title}" needs a source`).toBeGreaterThanOrEqual(1);
      for (const source of finding.sources) {
        expect(known.has(source.documentId), `unknown documentId in "${finding.title}"`).toBe(true);
      }
    }
  });

  it('exports markdown with a Source line per finding and every document name', () => {
    expect(markdown).toContain('Source:');
    for (const name of Object.keys(docs)) {
      expect(markdown).toContain(name);
    }
  });
});

describe('invalid samples in the same upload as valid ones (HTTP)', () => {
  const ctx = createTestApp();

  afterAll(() => {
    ctx.close();
  });

  it('rejects each invalid sample with its code and still accepts the valid file in the same request', async () => {
    let req = request(ctx.app).post('/api/documents');
    for (const sample of INVALID_SAMPLES) {
      req = req.attach('files', readSample(sample.name), {
        filename: path.basename(sample.name),
        contentType: sample.contentType,
      });
    }
    req = req.attach('files', readSample('kyc_summary.txt'), {
      filename: 'kyc_summary.txt',
      contentType: 'text/plain',
    });

    const res = await req;
    expect(res.status).toBe(200);
    const body = UploadResponseSchema.parse(res.body);

    expect(body.accepted.map((d) => d.originalName)).toEqual(['kyc_summary.txt']);
    const codes = Object.fromEntries(body.rejected.map((r) => [r.originalName, r.code]));
    for (const sample of INVALID_SAMPLES) {
      const fileName = path.basename(sample.name);
      expect(codes[fileName], `${fileName} should be rejected as ${sample.code}`).toBe(sample.code);
    }
    for (const rejected of body.rejected) {
      expect(rejected.reason.length).toBeGreaterThan(0);
    }

    // Consistent rule: rejected files are reported in the response only. The document list holds accepted files.
    const list = await request(ctx.app).get('/api/documents');
    expect((list.body as { documents: { originalName: string }[] }).documents.map((d) => d.originalName)).toEqual([
      'kyc_summary.txt',
    ]);
  });
});
