import multer from 'multer';
import { ZodError } from 'zod';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@mdw/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Catch-all for unknown /api routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function mapMulterError(err: multer.MulterError): MappedError {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return {
        status: 413,
        code: 'FILE_TOO_LARGE',
        message: 'A file is larger than the allowed size. The whole upload was rejected.',
      };
    case 'LIMIT_FILE_COUNT':
      return {
        status: 413,
        code: 'TOO_MANY_FILES',
        message: 'Too many files in one upload.',
      };
    case 'LIMIT_UNEXPECTED_FILE':
      return {
        status: 400,
        code: 'UNEXPECTED_FIELD',
        message: 'Files must be sent in the "files" field.',
      };
    default:
      return { status: 400, code: 'BAD_MULTIPART', message: 'Malformed multipart request.' };
  }
}

function mapZodError(err: ZodError): MappedError {
  return {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Request validation failed.',
    // Only path and message, never the received value or a stack trace.
    details: err.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}

/** Body-parser errors (malformed JSON, body too large) carry an HTTP status and expose flag. */
function mapBodyParserError(err: unknown): MappedError | null {
  if (typeof err !== 'object' || err === null) return null;
  if (!('status' in err) || typeof err.status !== 'number') return null;
  if (!('expose' in err) || err.expose !== true) return null;
  if (err.status === 413) {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
  }
  if (err.status >= 400 && err.status < 500) {
    return { status: err.status, code: 'BAD_REQUEST', message: 'Malformed request body.' };
  }
  return null;
}

/** Central error handler. Maps known errors to the ApiError envelope and never leaks stack traces. */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  let mapped: MappedError | null = null;

  if (err instanceof AppError) {
    mapped = {
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  } else if (err instanceof multer.MulterError) {
    mapped = mapMulterError(err);
  } else if (err instanceof ZodError) {
    // Issue paths and messages only, never values, so a validation failure can be diagnosed from the log.
    logger.warn('validation error', { issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ') });
    mapped = mapZodError(err);
  } else {
    mapped = mapBodyParserError(err);
  }

  if (mapped) {
    const body: ApiErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
      },
    };
    res.status(mapped.status).json(body);
    return;
  }

  // Log server-side only (no request body, no file content). Respond generically.
  logger.error('unhandled error', { name: err instanceof Error ? err.name : 'unknown' });
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  };
  res.status(500).json(body);
};
