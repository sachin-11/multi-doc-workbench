import { vi } from 'vitest';

/*
 * Runs before every server test file. Guarantees that the suite is offline and deterministic:
 *  - LLM_API_KEY is forced to empty, so the MOCK provider is used (no real API key is ever read).
 *  - fetch is replaced with a function that throws. Any code path that tries to reach the network
 *    fails the test loudly instead of silently calling a provider. Supertest uses node:http directly,
 *    so the in-process HTTP tests are not affected.
 */
process.env.LLM_API_KEY = '';

vi.stubGlobal('fetch', () => {
  throw new Error('Network access is disabled in server tests. Use the MOCK provider or a fake transport.');
});
