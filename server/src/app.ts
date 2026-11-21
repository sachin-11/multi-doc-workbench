import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Config } from './config/env.js';
import type { DocumentsRepo } from './db/repositories/documentsRepo.js';
import type { BufferStore } from './storage/bufferStore.js';
import { healthRouter } from './routes/health.js';
import { createDocumentsRouter } from './routes/documents.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export interface AppDependencies {
  config: Pick<Config, 'CLIENT_ORIGIN' | 'MAX_FILES' | 'MAX_FILE_SIZE_MB'>;
  documents: DocumentsRepo;
  buffers: BufferStore;
  enqueueProcessing: (documentId: string) => void;
}

/** Builds the Express app. All dependencies are passed in, so tests can use an in-memory DB. */
export function createApp(deps: AppDependencies): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: deps.config.CLIENT_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use(
    '/api/documents',
    createDocumentsRouter({
      documents: deps.documents,
      buffers: deps.buffers,
      enqueueProcessing: deps.enqueueProcessing,
      limits: { maxFiles: deps.config.MAX_FILES, maxFileSizeMb: deps.config.MAX_FILE_SIZE_MB },
    }),
  );

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
