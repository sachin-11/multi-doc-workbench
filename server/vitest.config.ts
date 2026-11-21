import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Never run tests from compiled output.
    exclude: ['dist/**', 'node_modules/**'],
    // The first PDF parse loads pdf.js and can exceed the 5 s default on a cold run.
    testTimeout: 20_000,
  },
});
