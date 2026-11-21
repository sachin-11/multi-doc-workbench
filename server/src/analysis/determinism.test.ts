import { afterEach, describe, expect, it } from 'vitest';
import { PerDocumentExtractionOutputSchema, type AnalysisResult } from '@mdw/shared';
import { createTestApp } from '../testing/testApp.js';
import { insertProcessed } from '../testing/documents.js';
import { createMockProvider } from '../llm/mockProvider.js';
import {
  createOpenAIProvider,
  type ChatCompletionClient,
  type ChatRequest,
  type ChatResponse,
} from '../llm/openaiProvider.js';
import type { LLMProvider, StructuredRequest, StructuredResult } from '../llm/types.js';

/*
 * Determinism. Temperature 0 on every model call, and a comparison that is the same every time because
 * code, not a model, produces it.
 */

const FORM_TEXT = ['Applicant: Rohan Mehta', 'Revenue FY2025: INR 4,80,00,000', 'Licence No: FSL-1'].join('\n');
const LETTER_TEXT = ['Applicant: Rohan Mehra', 'Revenue FY2025: INR 3,95,00,000'].join('\n');

describe('temperature 0', () => {
  let ctx: ReturnType<typeof createTestApp>;

  afterEach(() => {
    ctx?.close();
  });

  it('is sent on every call the analysis engine makes: each extraction call and the cross-document call', async () => {
    const inner = createMockProvider();
    const seen: Array<{ schemaName: string; temperature: number | undefined }> = [];
    const spy: LLMProvider = {
      name: 'mock',
      async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        seen.push({ schemaName: req.schemaName, temperature: req.temperature });
        return inner.generateStructured(req);
      },
    };
    ctx = createTestApp({ provider: spy });
    const form = insertProcessed(ctx, 'application_form.pdf', FORM_TEXT);
    const letter = insertProcessed(ctx, 'supporting_letter.txt', LETTER_TEXT);

    await ctx.analysisService.run({ documentIds: [form, letter], instruction: 'Compare the documents' });

    expect(seen.map((s) => s.schemaName)).toEqual([
      'document_extraction',
      'document_extraction',
      'cross_document_analysis',
    ]);
    expect(seen.every((s) => s.temperature === 0)).toBe(true);
  });

  describe('OpenAI-compatible provider', () => {
    const valid: ChatResponse = {
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    };
    const invalid: ChatResponse = { choices: [{ message: { content: '{"facts": "not a list"}' } }] };

    function recordingClient(replies: ChatResponse[]): { client: ChatCompletionClient; requests: ChatRequest[] } {
      const requests: ChatRequest[] = [];
      const client: ChatCompletionClient = {
        async createCompletion(request) {
          requests.push(request);
          const next = replies.shift();
          if (!next) throw new Error('no more scripted replies');
          return next;
        },
      };
      return { client, requests };
    }

    it('defaults to temperature 0 when the caller sets none', async () => {
      const { client, requests } = recordingClient([valid]);
      const provider = createOpenAIProvider({ model: 'test-model', client, retryBackoffMs: 1 });
      await provider.generateStructured({
        system: 'Extract.',
        user: 'Text.',
        schema: PerDocumentExtractionOutputSchema,
        schemaName: 'document_extraction',
      });
      expect(requests.map((r) => r.temperature)).toEqual([0]);
    });

    it('keeps temperature 0 on the repair retry', async () => {
      const { client, requests } = recordingClient([invalid, valid]);
      const provider = createOpenAIProvider({ model: 'test-model', client, retryBackoffMs: 1 });
      await provider.generateStructured({
        system: 'Extract.',
        user: 'Text.',
        schema: PerDocumentExtractionOutputSchema,
        schemaName: 'document_extraction',
        temperature: 0,
      });
      expect(requests).toHaveLength(2);
      expect(requests.map((r) => r.temperature)).toEqual([0, 0]);
    });
  });
});

describe('repeatable comparison', () => {
  /** What a reader sees, without run-specific ids. */
  function visible(result: AnalysisResult) {
    const strip = (f: AnalysisResult['findings'][number]) => ({
      type: f.type,
      title: f.title,
      description: f.description,
      severity: f.severity,
      sources: f.sources.map((s) => s.snippet),
    });
    return {
      findings: result.findings.map(strip),
      missing: result.missingInformation.map(strip),
      table: result.comparisonTable?.rows.map((r) => [r.field, r.consistent, Object.values(r.values)]),
      summary: result.summary,
    };
  }

  it('gives identical findings, missing items, table and summary on every run', async () => {
    const outputs: ReturnType<typeof visible>[] = [];
    for (let run = 0; run < 3; run += 1) {
      const ctx = createTestApp();
      const form = insertProcessed(ctx, 'application_form.pdf', FORM_TEXT);
      const letter = insertProcessed(ctx, 'supporting_letter.txt', LETTER_TEXT);
      outputs.push(visible(await ctx.analysisService.run({ documentIds: [form, letter], instruction: 'Compare' })));
      ctx.close();
    }
    expect(outputs[0]?.findings.length).toBeGreaterThan(0);
    expect(outputs[1]).toEqual(outputs[0]);
    expect(outputs[2]).toEqual(outputs[0]);
  });
});
