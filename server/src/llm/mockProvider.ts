import { logger } from '../lib/logger.js';
import { analyzeFacts } from './mockAnalysis.js';
import { extractFactsFromText } from './mockExtraction.js';
import { readDocumentBlock, readFactsPayload, SCHEMA_NAMES } from './prompts.js';
import { LLMOutputValidationError, type LLMProvider, type StructuredRequest, type StructuredResult } from './types.js';

/*
 * MOCK provider: deterministic, offline, no network. It reads the same prompt delimiters the
 * real model gets, and returns output that passes the same zod schemas.
 */

export function createMockProvider(): LLMProvider {
  return {
    name: 'mock',

    async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const raw = runRules(request.schemaName, request.user);
      const parsed = request.schema.safeParse(raw);
      if (!parsed.success) {
        // A rule bug, not a model error. Surface it the same way a bad model reply would be surfaced.
        throw new LLMOutputValidationError(
          request.schemaName,
          parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
        );
      }
      logger.info('mock llm call completed', { schemaName: request.schemaName });
      return { data: parsed.data };
    },
  };
}

function runRules(schemaName: string, user: string): unknown {
  if (schemaName === SCHEMA_NAMES.extraction) {
    const block = readDocumentBlock(user);
    if (!block) {
      throw new LLMOutputValidationError(schemaName, ['(root): no <document> block in the prompt']);
    }
    return { facts: extractFactsFromText(block.text) };
  }

  if (schemaName === SCHEMA_NAMES.crossDocument) {
    const payload = readFactsPayload(user);
    if (!payload) {
      throw new LLMOutputValidationError(schemaName, ['(root): no valid <facts_json> payload in the prompt']);
    }
    return analyzeFacts(payload);
  }

  throw new LLMOutputValidationError(schemaName, [`(root): the mock has no rules for "${schemaName}"`]);
}

