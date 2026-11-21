import { createApp } from '../app.js';
import { createAnalysisService, type AnalysisService } from '../analysis/analysisService.js';
import { openDatabase, type Db } from '../db/client.js';
import { createAnalysesRepo, type AnalysesRepo } from '../db/repositories/analysesRepo.js';
import { createDocumentsRepo, type DocumentsRepo } from '../db/repositories/documentsRepo.js';
import { createDocumentProcessor, type DocumentProcessor } from '../processing/index.js';
import { createBufferStore, type BufferStore } from '../storage/bufferStore.js';
import { createMockProvider } from '../llm/mockProvider.js';
import type { LLMProvider } from '../llm/types.js';

export interface TestAppOverrides {
  maxFiles?: number;
  maxFileSizeMb?: number;
  maxChars?: number;
  timeoutMs?: number;
  analysisTimeoutMs?: number;
  /** Replaces the MOCK provider, for example to simulate a failing document. */
  provider?: LLMProvider;
}

/** Test-only app with an in-memory SQLite DB, a real processor, the MOCK LLM provider, and no background timers. */
export function createTestApp(overrides: TestAppOverrides = {}) {
  const db: Db = openDatabase(':memory:');
  const documents: DocumentsRepo = createDocumentsRepo(db);
  const analyses: AnalysesRepo = createAnalysesRepo(db);
  const buffers: BufferStore = createBufferStore({ ttlMs: 60_000, sweepIntervalMs: 0 });
  const processor: DocumentProcessor = createDocumentProcessor({
    documents,
    buffers,
    options: {
      maxChars: overrides.maxChars ?? 60_000,
      timeoutMs: overrides.timeoutMs ?? 20_000,
      concurrency: 2,
    },
  });
  const provider = overrides.provider ?? createMockProvider();
  const analysisService: AnalysisService = createAnalysisService({
    documents,
    analyses,
    processor,
    provider,
    options: { timeoutMs: overrides.analysisTimeoutMs ?? 120_000 },
  });

  const app = createApp({
    config: {
      CLIENT_ORIGIN: 'http://localhost:5173',
      MAX_FILES: overrides.maxFiles ?? 10,
      MAX_FILE_SIZE_MB: overrides.maxFileSizeMb ?? 10,
    },
    documents,
    buffers,
    processor,
    analyses,
    analysisService,
  });

  return {
    app,
    documents,
    analyses,
    buffers,
    processor,
    analysisService,
    close: () => {
      buffers.close();
      db.close();
    },
  };
}
