import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const app = createApp(config);

app.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT}`);
  console.log(`[server] CORS origin: ${config.CLIENT_ORIGIN}`);
  console.log(
    `[server] LLM provider: ${config.LLM_API_KEY ? 'openai-compatible' : 'MOCK (no LLM_API_KEY set)'}`,
  );
});
