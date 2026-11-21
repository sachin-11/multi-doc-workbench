import type { Config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createMockProvider } from './mockProvider.js';
import { createOpenAIProvider, createOpenAISdkClient } from './openaiProvider.js';
import type { LLMProvider } from './types.js';

export type LLMConfig = Pick<Config, 'LLM_API_KEY' | 'LLM_BASE_URL' | 'LLM_MODEL'>;

/**
 * Picks the provider from config. No API key means the offline MOCK provider.
 * The name is what AnalysisResult.provider reports.
 */
export function getLLMProvider(config: LLMConfig): LLMProvider {
  if (!config.LLM_API_KEY) {
    logger.info('Using MOCK LLM provider (no LLM_API_KEY set)');
    return createMockProvider();
  }

  // Never log the key or the base URL. Model name only.
  logger.info('Using OpenAI-compatible LLM provider', { model: config.LLM_MODEL });
  return createOpenAIProvider({
    model: config.LLM_MODEL,
    client: createOpenAISdkClient({ apiKey: config.LLM_API_KEY, baseURL: config.LLM_BASE_URL }),
  });
}

export type { LLMProvider, StructuredRequest, StructuredResult } from './types.js';
export { LLMOutputValidationError, LLMRequestError } from './types.js';
