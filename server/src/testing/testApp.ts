import { createApp } from '../app.js';
import { openDatabase } from '../db/client.js';
import { createDocumentsRepo, type DocumentsRepo } from '../db/repositories/documentsRepo.js';
import { createDocumentProcessor, type DocumentProcessor } from '../processing/index.js';
import { createBufferStore, type BufferStore } from '../storage/bufferStore.js';

/** Test-only app with an in-memory SQLite DB, a real processor, and no background timers. */
export function createTestApp(
  overrides: { maxFiles?: number; maxFileSizeMb?: number; maxChars?: number; timeoutMs?: number } = {},
) {
  const db = openDatabase(':memory:');
  const documents: DocumentsRepo = createDocumentsRepo(db);
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

  const app = createApp({
    config: {
      CLIENT_ORIGIN: 'http://localhost:5173',
      MAX_FILES: overrides.maxFiles ?? 10,
      MAX_FILE_SIZE_MB: overrides.maxFileSizeMb ?? 10,
    },
    documents,
    buffers,
    processor,
  });

  return {
    app,
    documents,
    buffers,
    processor,
    close: () => {
      buffers.close();
      db.close();
    },
  };
}
