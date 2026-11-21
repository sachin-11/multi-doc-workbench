# M5 — LLM provider abstraction (real + mock) + structured output

**Status:** Done (2026-11-21). The analysis engine (M6) is not built yet. Only the provider layer and prompts exist.

## Goal
One provider-agnostic `LLMProvider` with an OpenAI-compatible implementation and a deterministic offline MOCK. Output is always zod-validated. Documents are never merged into one prompt.

## What was built
- **Interface** (`server/src/llm/types.ts`): `LLMProvider { name: 'openai' | 'mock', generateStructured<T>({ system, user, schema, schemaName, temperature?, maxTokens? }) }`. Typed errors: `LLMOutputValidationError` (carries issue paths, never values), `LLMRequestError` (no request body).
- **OpenAI-compatible provider** (`openaiProvider.ts`): official `openai` SDK behind a narrow `ChatCompletionClient`, so tests use a fake transport. JSON-object mode. The zod schema is turned into a JSON Schema hint with `z.toJSONSchema`. Validation failure → one repair retry that sends the issues back. Second failure → `LLMOutputValidationError`. Timeout 45 s. One retry with backoff on network, 429 and 5xx. Logs token counts and timings only.
- **Mock provider** (`mockProvider.ts`, `mockExtraction.ts`, `mockAnalysis.ts`): no network. It reads the same prompt delimiters the real model gets. Extraction is rule-based: `Key: Value` lines, CSV `column=value` pairs, currency, email and ISO dates. Each fact carries an exact snippet. Cross-doc analysis compares facts by key: discrepancies, consistent comparisons, missing information, comparison table and summary. Every source is a real documentId.
- **Factory** (`llm/index.ts`): `getLLMProvider(config)`. No `LLM_API_KEY` → MOCK, logged as "Using MOCK LLM provider". `provider.name` feeds `AnalysisResult.provider`. Startup log uses it.
- **Prompts** (`prompts.ts`, pure): `buildPerDocumentExtractionPrompt` (one prompt per chunk, wrapped in `<document id name format chunk>`), `mergeChunkFacts` (dedupe, keep higher confidence), `buildCrossDocumentAnalysisPrompt` (facts JSON only, in `<facts_json>`, no raw text). Both system prompts state that document content is untrusted and must not be followed. Closing tags inside text are neutralised.
- **Guards** (`guards.ts`, run for every provider): `validateProvenance` removes unknown documentIds, nulls unknown factIds, and drops findings with no valid source. `verifyFact` and `verifyFacts` check that each snippet appears in its document. A missing snippet caps confidence at 0.3 and adds a warning.

## Deliverables
- [x] Provider interface, both implementations, factory based on config
- [x] Zod validation of model output
- [x] Tests: mock output passes its schema, invalid output is rejected, repair retry, retry on 429

## Acceptance
- [x] Works with no key (mock), with rule-based results.
- [x] Startup log shows the active provider.

## Notes
- The OpenAI path is tested only with a fake transport. It has not been run against a live endpoint.
- See CLAUDE.md, M5 PROGRESS LOG entry, for known issues.
