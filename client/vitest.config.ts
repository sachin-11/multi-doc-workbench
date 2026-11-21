import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests run in jsdom. The app itself is still built and served by vite.config.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
