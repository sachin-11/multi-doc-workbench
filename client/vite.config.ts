import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  // Read the root-level .env so the proxy target follows the server PORT.
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, rootDir, '');
  const serverPort = env.PORT && env.PORT.length > 0 ? env.PORT : '4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
