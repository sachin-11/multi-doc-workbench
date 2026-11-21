import express from 'express';
import cors from 'cors';
import type { Config } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

/** Builds the Express app. Takes only the config it needs, so it can be tested without process.env. */
export function createApp(config: Pick<Config, 'CLIENT_ORIGIN'>): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.CLIENT_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
