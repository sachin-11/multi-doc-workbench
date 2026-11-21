import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Never run tests from compiled output.
    exclude: ['dist/**', 'node_modules/**'],
    // Offline guarantees: forces LLM_API_KEY empty and blocks fetch (see test/setup.ts).
    setupFiles: ['test/setup.ts'],
    // Unit tests are fast. A cold PDF parse can take a few seconds, so keep headroom.
    // The samples e2e file raises its own timeout in beforeAll.
    testTimeout: 10_000,
  },
});
