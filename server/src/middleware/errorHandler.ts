import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@mdw/shared';
import { AppError } from '../lib/errors.js';

/** Catch-all for unknown /api routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

/** Central error handler: maps AppError to its status, everything else to a generic 500. */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    res.status(err.status).json(body);
    return;
  }

  // Log full details server-side; never leak internals to the client.
  console.error('[unhandled error]', err);
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  };
  res.status(500).json(body);
};
