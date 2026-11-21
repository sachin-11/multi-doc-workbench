import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Never run tests from compiled output.
    exclude: ['dist/**', 'node_modules/**'],
  },
});
