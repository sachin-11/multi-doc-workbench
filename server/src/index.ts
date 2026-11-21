import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { openDatabase } from './db/client.js';
import { createDocumentsRepo } from './db/repositories/documentsRepo.js';
import { enqueueProcessing } from './processing/index.js';
import { createBufferStore } from './storage/bufferStore.js';

const config = loadConfig();
const db = openDatabase(config.DB_PATH);
const app = createApp({
  config,
  documents: createDocumentsRepo(db),
  buffers: createBufferStore({ ttlMs: config.BUFFER_TTL_MINUTES * 60_000 }),
  enqueueProcessing,
});

app.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT}`);
  console.log(`[server] database: ${config.DB_PATH}`);
  console.log(`[server] CORS origin: ${config.CLIENT_ORIGIN}`);
  console.log(`[server] upload limits: ${config.MAX_FILES} files, ${config.MAX_FILE_SIZE_MB} MB each`);
  console.log(
    `[server] LLM provider: ${config.LLM_API_KEY ? 'openai-compatible' : 'MOCK (no LLM_API_KEY set)'}`,
  );
});
