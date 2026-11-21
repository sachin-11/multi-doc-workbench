import type { ZodType } from 'zod';

export type LLMProviderName = 'openai' | 'mock';

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  /** Stable name for logs and the schema hint, e.g. "document_extraction". */
  schemaName: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResult<T> {
  data: T;
  usage?: TokenUsage;
}

/** Provider-agnostic interface. Every result has passed the given zod schema. */
export interface LLMProvider {
  readonly name: LLMProviderName;
  generateStructured<T>(args: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

/** The model returned output that still failed validation after one repair retry. */
export class LLMOutputValidationError extends Error {
  constructor(
    readonly schemaName: string,
    readonly issues: readonly string[],
  ) {
    super(`The model returned output that does not match the "${schemaName}" schema.`);
    this.name = 'LLMOutputValidationError';
  }
}

/** The request failed (network, timeout, rate limit, server error) after retries. Never includes the request body. */
export class LLMRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LLMRequestError';
  }
}
