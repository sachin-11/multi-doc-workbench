# M5 — LLM provider abstraction (real + mock) + structured output

**Status:** Not started

## Goal
One `LlmProvider` interface with an OpenAI-compatible implementation and a deterministic MOCK. Output is always validated with zod.

## Scope
- `LlmProvider` interface: `completeJson(schema, messages) -> z.infer<schema>`.
- `OpenAiCompatibleProvider`: uses `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
- `MockProvider`: used automatically when `LLM_API_KEY` is empty. Returns schema-valid output derived from the input (e.g. extracts values with simple regex), so the whole app works offline.
- On invalid JSON or schema mismatch: one retry, then a typed error. Never pass raw model text to the UI.

## Deliverables
- [ ] Provider interface, both implementations, factory based on config
- [ ] Zod validation of model output
- [ ] Unit test: mock provider output passes its schema; invalid output is rejected

## Acceptance
- App runs with no key and produces results.
- Startup log shows which provider is active (already logged in M1).
