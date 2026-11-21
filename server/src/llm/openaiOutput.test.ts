import { describe, expect, it } from 'vitest';
import { CrossDocumentAnalysisOutputSchema } from '@mdw/shared';
import { createOpenAIProvider, type ChatCompletionClient, type ChatRequest, type ChatResponse } from './openaiProvider.js';
import { SCHEMA_NAMES } from './prompts.js';

/*
 * Found in live testing: the prompt tells the model that the comparison table and the missing-information list
 * are built by code and must be left empty. The model answered with a valid summary and findings, but left out the
 * "comparisonTable" key. A strict schema rejected that reply, and the repair retry made it worse, so the whole
 * analysis failed over a field nobody uses.
 */
function scripted(content: string): { client: ChatCompletionClient; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const response: ChatResponse = { choices: [{ message: { content } }] };
  return {
    requests,
    client: {
      async createCompletion(request) {
        requests.push(request);
        return response;
      },
    },
  };
}

describe('cross-document output with keys left out', () => {
  it('accepts a reply that omits comparisonTable and missingInformation, without a repair retry', async () => {
    const { client, requests } = scripted(JSON.stringify({ summary: 'Two documents compared.', findings: [] }));
    const provider = createOpenAIProvider({ model: 'test-model', client, retryBackoffMs: 1 });

    const { data } = await provider.generateStructured({
      system: 'Interpret.',
      user: 'Facts.',
      schema: CrossDocumentAnalysisOutputSchema,
      schemaName: SCHEMA_NAMES.crossDocument,
      temperature: 0,
    });

    expect(requests).toHaveLength(1);
    expect(data.summary).toBe('Two documents compared.');
    expect(data.findings).toEqual([]);
    expect(data.missingInformation).toEqual([]);
    expect(data.comparisonTable).toBeNull();
  });

  it('accepts a reply that leaves out the summary too', () => {
    const parsed = CrossDocumentAnalysisOutputSchema.parse({});
    expect(parsed).toEqual({ findings: [], missingInformation: [], comparisonTable: null, summary: null });
  });

  it('still rejects a finding that has no sources', () => {
    const result = CrossDocumentAnalysisOutputSchema.safeParse({
      findings: [{ type: 'discrepancy', title: 'x', description: 'y', severity: 'high', sources: [] }],
    });
    expect(result.success).toBe(false);
  });
});
