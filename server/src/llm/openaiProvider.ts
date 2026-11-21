import OpenAI from 'openai';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import {
  LLMOutputValidationError,
  LLMRequestError,
  type LLMProvider,
  type StructuredRequest,
  type StructuredResult,
  type TokenUsage,
} from './types.js';

/*
 * OpenAI-compatible provider. Works with OpenAI or any endpoint that speaks the chat completions API.
 * Logging: token counts and timings only. Never prompts, responses, document text, or the API key.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens?: number;
  response_format: { type: 'json_object' };
}

export interface ChatResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}

/** Narrow transport interface. The real SDK is adapted to it, and tests pass a fake. */
export interface ChatCompletionClient {
  createCompletion(request: ChatRequest, options: { timeoutMs: number }): Promise<ChatResponse>;
}

export interface OpenAIProviderOptions {
  model: string;
  client: ChatCompletionClient;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Delay before the single transport retry. */
  retryBackoffMs?: number;
}

type CallOptions = Pick<StructuredRequest<unknown>, 'schemaName' | 'temperature' | 'maxTokens'>;

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_BACKOFF_MS = 500;
const MAX_ISSUES_SENT_BACK = 20;

/** Adapts the official openai SDK to ChatCompletionClient. SDK-level retries are off; we control them. */
export function createOpenAISdkClient(config: { apiKey: string; baseURL: string }): ChatCompletionClient {
  const sdk = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 0 });
  return {
    async createCompletion(request, options) {
      const response = await sdk.chat.completions.create(request, { timeout: options.timeoutMs });
      return {
        choices: response.choices.map((choice) => ({ message: { content: choice.message.content } })),
        usage: response.usage
          ? { prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens }
          : null,
      };
    },
  };
}

/** Network errors, timeouts, 429 and 5xx are worth one retry. Other 4xx are not. */
export function isRetryableError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number') {
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error) {
    return ['APIConnectionError', 'APIConnectionTimeoutError', 'TimeoutError'].includes(err.name);
  }
  return false;
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number') {
    return err.status;
  }
  return undefined;
}

/** Turns zod issues into short "path: message" lines. Values are never included. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues
    .slice(0, MAX_ISSUES_SENT_BACK)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
}

export function repairMessage(issues: readonly string[]): string {
  return [
    'Your previous output failed validation:',
    ...issues.map((line) => `- ${line}`),
    'Return corrected JSON only, with no commentary.',
  ].join('\n');
}

function schemaHint<T>(system: string, schemaName: string, schema: z.ZodType<T>): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  return `${system}\n\nReturn a single JSON object that matches the "${schemaName}" JSON schema:\n${jsonSchema}`;
}

function addUsage(total: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!next) return total;
  if (!total) return next;
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
  };
}

export function createOpenAIProvider(options: OpenAIProviderOptions): LLMProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoffMs = options.retryBackoffMs ?? DEFAULT_BACKOFF_MS;

  /** One chat call, with a single retry on retryable failures. */
  async function complete(
    messages: ChatMessage[],
    request: CallOptions,
  ): Promise<{ content: string; usage?: TokenUsage }> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      try {
        const response = await options.client.createCompletion(
          {
            model: options.model,
            messages,
            temperature: request.temperature ?? 0,
            ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
            response_format: { type: 'json_object' },
          },
          { timeoutMs },
        );
        const content = response.choices[0]?.message.content ?? '';
        const usage = response.usage
          ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
          : undefined;
        logger.info('llm call completed', {
          schemaName: request.schemaName,
          attempt,
          ms: Date.now() - started,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
        });
        return { content, usage };
      } catch (err) {
        const retry = attempt === 1 && isRetryableError(err);
        logger.warn('llm call failed', {
          schemaName: request.schemaName,
          attempt,
          status: statusOf(err) ?? null,
          willRetry: retry,
        });
        if (!retry) {
          throw new LLMRequestError('The LLM request failed or timed out.', statusOf(err));
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw new LLMRequestError('The LLM request failed or timed out.');
  }

  /** Parses and validates one model reply. Returns either data or the issues to send back. */
  function check<T>(
    content: string,
    schema: z.ZodType<T>,
  ): { ok: true; data: T } | { ok: false; issues: string[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return { ok: false, issues: ['(root): the output is not valid JSON'] };
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { ok: true, data: parsed.data };
    return { ok: false, issues: describeIssues(parsed.error) };
  }

  return {
    name: 'openai',

    async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const system = schemaHint(request.system, request.schemaName, request.schema);
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: request.user },
      ];

      const first = await complete(messages, request);
      const firstCheck = check(first.content, request.schema);
      if (firstCheck.ok) {
        return { data: firstCheck.data, usage: first.usage };
      }

      // One repair retry: send the validation errors back and ask for corrected JSON only.
      const repairMessages: ChatMessage[] = [
        ...messages,
        { role: 'assistant', content: first.content },
        { role: 'user', content: repairMessage(firstCheck.issues) },
      ];
      const second = await complete(repairMessages, request);
      const secondCheck = check(second.content, request.schema);
      const usage = addUsage(first.usage, second.usage);

      if (secondCheck.ok) {
        return { data: secondCheck.data, usage };
      }
      throw new LLMOutputValidationError(request.schemaName, secondCheck.issues);
    },
  };
}
