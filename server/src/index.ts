import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { openDatabase } from './db/client.js';
import { createAnalysesRepo } from './db/repositories/analysesRepo.js';
import { createDocumentsRepo } from './db/repositories/documentsRepo.js';
import { createDocumentProcessor } from './processing/index.js';
import { createBufferStore } from './storage/bufferStore.js';
import { createAnalysisService } from './analysis/analysisService.js';
import { getLLMProvider } from './llm/index.js';

const config = loadConfig();
const db = openDatabase(config.DB_PATH);
const documents = createDocumentsRepo(db);
const analyses = createAnalysesRepo(db);
const buffers = createBufferStore({ ttlMs: config.BUFFER_TTL_MINUTES * 60_000 });
const processor = createDocumentProcessor({
  documents,
  buffers,
  options: {
    maxChars: config.MAX_CHARS_PER_DOCUMENT,
    timeoutMs: config.PROCESSING_TIMEOUT_MS,
    concurrency: config.PROCESSING_CONCURRENCY,
  },
});
const provider = getLLMProvider(config);
const analysisService = createAnalysisService({
  documents,
  analyses,
  processor,
  provider,
  options: { timeoutMs: config.ANALYSIS_TIMEOUT_MS },
});
const app = createApp({ config, documents, buffers, processor, analyses, analysisService });

app.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT}`);
  console.log(`[server] database: ${config.DB_PATH}`);
  console.log(`[server] CORS origin: ${config.CLIENT_ORIGIN}`);
  console.log(`[server] upload limits: ${config.MAX_FILES} files, ${config.MAX_FILE_SIZE_MB} MB each`);
  console.log(`[server] LLM provider: ${provider.name}`);
});
