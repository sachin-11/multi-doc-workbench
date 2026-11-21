import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { openDatabase } from './db/client.js';

const config = loadConfig();
// Schema is applied on open. The handle is passed to repositories in M3+.
openDatabase(config.DB_PATH);
const app = createApp(config);

app.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT}`);
  console.log(`[server] database: ${config.DB_PATH}`);
  console.log(`[server] CORS origin: ${config.CLIENT_ORIGIN}`);
  console.log(
    `[server] LLM provider: ${config.LLM_API_KEY ? 'openai-compatible' : 'MOCK (no LLM_API_KEY set)'}`,
  );
});
