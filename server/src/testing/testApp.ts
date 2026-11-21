import { createApp } from '../app.js';
import { openDatabase } from '../db/client.js';
import { createDocumentsRepo, type DocumentsRepo } from '../db/repositories/documentsRepo.js';
import { createBufferStore, type BufferStore } from '../storage/bufferStore.js';

/** Test-only app with an in-memory SQLite DB and no background timers. */
export function createTestApp(overrides: { maxFiles?: number; maxFileSizeMb?: number } = {}) {
  const db = openDatabase(':memory:');
  const documents: DocumentsRepo = createDocumentsRepo(db);
  const buffers: BufferStore = createBufferStore({ ttlMs: 60_000, sweepIntervalMs: 0 });
  const enqueued: string[] = [];

  const app = createApp({
    config: {
      CLIENT_ORIGIN: 'http://localhost:5173',
      MAX_FILES: overrides.maxFiles ?? 10,
      MAX_FILE_SIZE_MB: overrides.maxFileSizeMb ?? 10,
    },
    documents,
    buffers,
    enqueueProcessing: (id) => {
      enqueued.push(id);
    },
  });

  return {
    app,
    documents,
    buffers,
    enqueued,
    close: () => {
      buffers.close();
      db.close();
    },
  };
}
