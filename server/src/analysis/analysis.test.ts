import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  AnalysisListResponseSchema,
  AnalysisResultSchema,
  type AnalysisResult,
  type DocumentMeta,
  type ParsedDocument,
} from '@mdw/shared';
import { createTestApp } from '../testing/testApp.js';
import { chunkText, normalizeText } from '../processing/text.js';
import { createMockProvider } from '../llm/mockProvider.js';
import { LLMRequestError, type LLMProvider, type StructuredRequest, type StructuredResult } from '../llm/types.js';
import { SCHEMA_NAMES } from '../llm/prompts.js';
import { enforceFactOwnership, normalizeForMatch } from '../llm/guards.js';
import { toMarkdown } from './formatters.js';

const NOW = '2026-11-21T10:00:00.000Z';

/* Synthetic documents. One field per line, because the MOCK extractor reads "Label: value" lines. */
const TEXT_A = [
  'Applicant Name: Rahul Verma',
  'Annual Revenue: INR 50,00,000',
  'Licence No: DL-2024-1188',
].join('\n');
const TEXT_B = ['Applicant Name: Rahul Varma', 'Annual Revenue: INR 42,00,000'].join('\n');

const INSTRUCTION = 'Highlight discrepancies in names, licence details and revenue';

type Ctx = ReturnType<typeof createTestApp>;

/** Inserts a document as the processing pipeline would leave it: processed with stored text and chunks. */
function insertProcessed(ctx: Ctx, name: string, text: string): string {
  const id = randomUUID();
  const meta: DocumentMeta = {
    id,
    originalName: name,
    sanitizedName: name,
    mimeType: 'text/plain',
    format: 'txt',
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    status: 'uploaded',
    errorMessage: null,
    charCount: 0,
    wasTruncated: false,
    createdAt: NOW,
  };
  ctx.documents.insert(meta, null);
  const normalized = normalizeText(text);
  const parsed: ParsedDocument = {
    documentId: id,
    format: 'txt',
    text: normalized,
    pages: null,
    rows: null,
    columns: null,
    charCount: normalized.length,
    wasTruncated: false,
    chunks: chunkText(normalized),
    warnings: [],
  };
  ctx.documents.saveParsed(id, parsed);
  return id;
}

/** Inserts a document that never reached "processed". */
function insertFailed(ctx: Ctx, name: string): string {
  const id = randomUUID();
  ctx.documents.insert(
    {
      id,
      originalName: name,
      sanitizedName: name,
      mimeType: 'text/plain',
      format: 'txt',
      sizeBytes: 10,
      status: 'uploaded',
      errorMessage: null,
      charCount: 0,
      wasTruncated: false,
      createdAt: NOW,
    },
    null,
  );
  ctx.documents.updateStatus(id, 'failed', 'simulated failure');
  return id;
}

async function runAnalysis(ctx: Ctx, documentIds: string[], instruction = INSTRUCTION) {
  return request(ctx.app).post('/api/analyses').send({ documentIds, instruction });
}

describe('analysis engine (end to end, MOCK provider, in-memory DB)', () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = createTestApp();
  });

  afterEach(() => {
    ctx.close();
  });

  it('runs two-stage analysis with provenance across two documents', async () => {
    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);

    const res = await runAnalysis(ctx, [docA, docB]);
    expect(res.status).toBe(200);
    const result: AnalysisResult = AnalysisResultSchema.parse(res.body);

    expect(result.status).toBe('completed');
    expect(result.provider).toBe('mock');
    expect(result.warnings).toEqual([]);

    // Facts exist for both documents, and every snippet is present in its own document's text.
    const factsA = result.perDocumentFacts[docA] ?? [];
    const factsB = result.perDocumentFacts[docB] ?? [];
    expect(factsA.length).toBeGreaterThan(0);
    expect(factsB.length).toBeGreaterThan(0);
    const textOf: Record<string, string> = { [docA]: TEXT_A, [docB]: TEXT_B };
    for (const fact of [...factsA, ...factsB]) {
      expect(normalizeForMatch(textOf[fact.documentId] ?? '')).toContain(normalizeForMatch(fact.sourceSnippet));
    }

    // Revenue discrepancy cites BOTH documents.
    const revenue = result.findings.find((f) => f.type === 'discrepancy' && f.title.includes('revenue'));
    expect(revenue).toBeDefined();
    const revenueDocs = new Set(revenue?.sources.map((s) => s.documentId));
    expect(revenueDocs).toEqual(new Set([docA, docB]));

    // Name discrepancy is also reported (Verma vs Varma).
    expect(result.findings.some((f) => f.type === 'discrepancy' && f.title.includes('applicant'))).toBe(true);

    // Licence is only in document A, so the missing-information report cites document B.
    const licence = result.missingInformation.find((f) => f.title.includes('licence'));
    expect(licence).toBeDefined();
    expect(licence?.sources.map((s) => s.documentId)).toContain(docB);

    // Provenance: no citation points outside this analysis, and every finding is marked as interpretation.
    const allowed = new Set(result.documentIds);
    for (const finding of [...result.findings, ...result.missingInformation]) {
      expect(finding.sources.length).toBeGreaterThan(0);
      expect(finding.isInterpretation).toBe(true);
      for (const source of finding.sources) expect(allowed.has(source.documentId)).toBe(true);
    }

    // The saved analysis reads back identically.
    const fetched = await request(ctx.app).get(`/api/analyses/${result.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(result);
  });

  it('completes with a warning when one selected document failed earlier', async () => {
    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docBroken = insertFailed(ctx, 'corrupt.pdf');

    const res = await runAnalysis(ctx, [docA, docBroken]);
    expect(res.status).toBe(200);
    const result = AnalysisResultSchema.parse(res.body);

    expect(result.status).toBe('completed');
    expect(result.documentIds).toEqual([docA]);
    expect(result.warnings.some((w) => w.includes('corrupt.pdf'))).toBe(true);
    // One usable document: single-document mode, so no discrepancies are produced.
    expect(result.warnings.some((w) => w.startsWith('Single-document mode'))).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).not.toBeNull();
  });

  it('keeps the run going when one document fails extraction', async () => {
    // The provider fails only for the document named "broken.txt" in its prompt.
    const inner = createMockProvider();
    const provider: LLMProvider = {
      name: 'mock',
      async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        if (req.schemaName === SCHEMA_NAMES.extraction && req.user.includes('name="broken.txt"')) {
          throw new LLMRequestError('simulated provider failure');
        }
        return inner.generateStructured(req);
      },
    };
    ctx.close();
    ctx = createTestApp({ provider });

    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);
    const docBroken = insertProcessed(ctx, 'broken.txt', 'Applicant Name: Someone Else');

    const res = await runAnalysis(ctx, [docA, docB, docBroken]);
    const result = AnalysisResultSchema.parse(res.body);

    expect(result.status).toBe('completed');
    expect(result.warnings.some((w) => w.includes('broken.txt') && w.includes('excluded'))).toBe(true);
    expect(result.perDocumentFacts[docBroken]).toEqual([]);
    // The two healthy documents still produce the cross-document revenue discrepancy.
    expect(result.findings.some((f) => f.title.includes('revenue'))).toBe(true);
    const cited = result.findings.flatMap((f) => f.sources.map((s) => s.documentId));
    expect(cited).not.toContain(docBroken);
  });

  it('marks the run failed when the cross-document stage fails, and keeps the facts already saved', async () => {
    const inner = createMockProvider();
    const provider: LLMProvider = {
      name: 'mock',
      async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        if (req.schemaName === SCHEMA_NAMES.crossDocument) throw new LLMRequestError('simulated outage');
        return inner.generateStructured(req);
      },
    };
    ctx.close();
    ctx = createTestApp({ provider });

    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);
    const res = await runAnalysis(ctx, [docA, docB]);

    expect(res.status).toBe(200);
    const result = AnalysisResultSchema.parse(res.body);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('simulated outage');
    expect(result.completedAt).not.toBeNull();
    expect((result.perDocumentFacts[docA] ?? []).length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
  });

  it('marks the run failed when the total time budget is exceeded', async () => {
    const inner = createMockProvider();
    const slow: LLMProvider = {
      name: 'mock',
      async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return inner.generateStructured(req);
      },
    };
    ctx.close();
    ctx = createTestApp({ provider: slow, analysisTimeoutMs: 20 });

    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);
    const res = await runAnalysis(ctx, [docA, docB]);

    const result = AnalysisResultSchema.parse(res.body);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('took too long');
  });

  it('rejects a run with no usable document, listing the problems, and creates no analysis', async () => {
    const docBroken = insertFailed(ctx, 'corrupt.pdf');
    const res = await runAnalysis(ctx, [docBroken, randomUUID()]);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_USABLE_DOCUMENTS');
    expect(res.body.error.details.problems).toHaveLength(2);
    expect(ctx.analyses.list(10)).toEqual([]);
  });

  it('validates the request body with zod', async () => {
    const res = await request(ctx.app).post('/api/analyses').send({ documentIds: ['not-a-uuid'], instruction: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('exports markdown with sources per finding, and separates facts from interpretation', async () => {
    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);
    const run = await runAnalysis(ctx, [docA, docB]);
    const id = run.body.id as string;

    const res = await request(ctx.app).get(`/api/analyses/${id}/export?format=markdown`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('Source:');
    expect(res.text).toContain('application.txt');
    expect(res.text).toContain('financials.txt');
    expect(res.text).toContain('AI interpretation');
    expect(res.text).toContain('Extracted facts');
    expect(res.text.indexOf('Extracted facts')).toBeGreaterThan(res.text.indexOf('AI interpretation'));
  });

  it('exports JSON that matches the stored result, and rejects unknown formats', async () => {
    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);
    const run = await runAnalysis(ctx, [docA, docB]);
    const id = run.body.id as string;

    const json = await request(ctx.app).get(`/api/analyses/${id}/export?format=json`);
    expect(json.status).toBe(200);
    expect(AnalysisResultSchema.parse(json.body).id).toBe(id);

    const bad = await request(ctx.app).get(`/api/analyses/${id}/export?format=pdf`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists analyses, returns 404 for unknown ids, and rejects malformed ids', async () => {
    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);
    const run = await runAnalysis(ctx, [docA, docB]);

    const list = await request(ctx.app).get('/api/analyses');
    expect(list.status).toBe(200);
    const parsed = AnalysisListResponseSchema.parse(list.body);
    expect(parsed.analyses[0]).toMatchObject({ id: run.body.id, status: 'completed', documentIds: [docA, docB] });

    expect((await request(ctx.app).get(`/api/analyses/${randomUUID()}`)).status).toBe(404);
    expect((await request(ctx.app).get('/api/analyses/not-a-uuid')).status).toBe(400);
  });

  it('refuses to delete a document that a saved analysis used', async () => {
    const docA = insertProcessed(ctx, 'application.txt', TEXT_A);
    const docB = insertProcessed(ctx, 'financials.txt', TEXT_B);
    await runAnalysis(ctx, [docA, docB]);

    const res = await request(ctx.app).delete(`/api/documents/${docA}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENT_IN_USE');
  });
});

describe('guards and formatters (pure)', () => {
  it('drops a factId that belongs to a different document, keeping the document citation', () => {
    const docA = randomUUID();
    const docB = randomUUID();
    const factOfB = randomUUID();
    const output = {
      findings: [
        {
          type: 'discrepancy' as const,
          title: 't',
          description: 'd',
          severity: 'low' as const,
          sources: [{ documentId: docA, factId: factOfB, snippet: 'x' }],
        },
      ],
      missingInformation: [],
      comparisonTable: null,
      summary: null,
    };
    const result = enforceFactOwnership(output, new Map([[factOfB, docB]]));
    expect(result.cleaned.findings[0]?.sources[0]).toEqual({ documentId: docA, factId: null, snippet: 'x' });
    expect(result.warnings).toHaveLength(1);
  });

  it('renders document names with brackets escaped and never leaks raw ids into the Source line', () => {
    const docA = randomUUID();
    const result: AnalysisResult = {
      id: randomUUID(),
      instruction: 'check',
      status: 'completed',
      documentIds: [docA],
      perDocumentFacts: { [docA]: [] },
      findings: [
        {
          id: randomUUID(),
          analysisId: randomUUID(),
          type: 'discrepancy',
          title: 'Revenue',
          description: 'differs',
          severity: 'high',
          sources: [{ documentId: docA, factId: null, snippet: null }],
          isInterpretation: true,
        },
      ],
      comparisonTable: null,
      summary: 'Summary text',
      missingInformation: [],
      provider: 'mock',
      warnings: [],
      errorMessage: null,
      createdAt: NOW,
      completedAt: NOW,
    };
    const md = toMarkdown(result, new Map([[docA, { originalName: 'form [draft].pdf' }]]));
    expect(md).toContain('[Source: form \\[draft\\].pdf]');
    expect(md).not.toContain(docA);
  });
});
