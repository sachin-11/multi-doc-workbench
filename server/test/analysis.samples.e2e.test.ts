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

  it('finds the revenue discrepancy and cites at least application_form and supporting_letter', () => {
    const revenue = findByPrefix(analysis.findings, 'discrepancy', 'revenue_fy2025');
    expect(revenue, 'revenue discrepancy').toBeDefined();
    const cited = new Set(revenue?.sources.map((s) => s.documentId));
    expect(cited.has(docs['application_form.pdf']?.id ?? '')).toBe(true);
    expect(cited.has(docs['supporting_letter.txt']?.id ?? '')).toBe(true);
  });

  it('finds the applicant name discrepancy (Mehta vs Mehra)', () => {
    const name = findByPrefix(analysis.findings, 'discrepancy', 'applicant');
    expect(name, 'applicant name discrepancy').toBeDefined();
    expect(name?.description).toMatch(/Mehta/);
    expect(name?.description).toMatch(/Mehra/);
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
  });
});
