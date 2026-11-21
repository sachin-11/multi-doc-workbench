import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import {
  DocumentIdSchema,
  DocumentListResponseSchema,
  DocumentMetaSchema,
  UploadResponseSchema,
  type DocumentMeta,
  type RejectedFile,
} from '@mdw/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { DocumentsRepo } from '../db/repositories/documentsRepo.js';
import type { BufferStore } from '../storage/bufferStore.js';
import { validateUpload, type IncomingFile } from '../upload/validation.js';

export interface DocumentsRouteDeps {
  documents: DocumentsRepo;
  buffers: BufferStore;
  /** Processing hook (M4). Called once per accepted document. */
  enqueueProcessing: (documentId: string) => void;
  limits: { maxFiles: number; maxFileSizeMb: number };
}

const FILE_FIELD = 'files';
const MB = 1024 * 1024;

function requireMultipart(req: { is(type: string): string | false | null }): void {
  if (!req.is('multipart/form-data')) {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Send files as multipart/form-data in the "${FILE_FIELD}" field.`,
    );
  }
}

export function createDocumentsRouter(deps: DocumentsRouteDeps): Router {
  const { documents, buffers, enqueueProcessing, limits } = deps;
  const router = Router();

  // Memory storage only. Files never touch disk, and user-supplied names are never used as paths.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: limits.maxFiles,
      fileSize: Math.floor(limits.maxFileSizeMb * MB),
      fields: 5,
      fieldSize: 1024,
      parts: limits.maxFiles + 5,
    },
  }).array(FILE_FIELD, limits.maxFiles);

  // POST /api/documents: partial success. Valid files are stored, invalid ones are reported.
  router.post(
    '/',
    (req, _res, next) => {
      requireMultipart(req);
      next();
    },
    upload,
    (req, res) => {
      const uploaded = Array.isArray(req.files) ? req.files : [];
      if (uploaded.length === 0) {
        throw new AppError(400, 'NO_FILES', `Attach at least one file in the "${FILE_FIELD}" field.`);
      }

      const accepted: DocumentMeta[] = [];
      const rejected: RejectedFile[] = [];

      for (const file of uploaded) {
        const incoming: IncomingFile = {
          originalName: file.originalname,
          declaredMimeType: file.mimetype,
          buffer: file.buffer,
        };
        const result = validateUpload(incoming, {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        });

        // Rejected files are recorded too, so the UI can list them with their reason.
        documents.insert(result.meta, null);

        if (result.ok) {
          buffers.put(result.meta.id, file.buffer);
          accepted.push(result.meta);
          enqueueProcessing(result.meta.id);
        } else {
          rejected.push({
            originalName: result.meta.originalName,
            code: result.code,
            reason: result.reason,
          });
        }
      }

      logger.info('upload handled', { received: uploaded.length, accepted: accepted.length, rejected: rejected.length });
      res.json(UploadResponseSchema.parse({ accepted, rejected }));
    },
  );

  // GET /api/documents: metadata only. Never returns extracted text or buffers.
  router.get('/', (_req, res) => {
    res.json(DocumentListResponseSchema.parse({ documents: documents.list() }));
  });

  // GET /api/documents/:id
  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const record = documents.getById(id);
    if (!record) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    // Zod strips extractedText because it is not part of DocumentMeta.
    res.json(DocumentMetaSchema.parse(record));
  });

  // DELETE /api/documents/:id: removes the row and the in-memory bytes.
  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!documents.delete(id)) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    buffers.delete(id);
    res.status(204).end();
  });

  return router;
}

function parseId(raw: unknown): string {
  const parsed = DocumentIdSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, 'INVALID_ID', 'Document id must be a UUID.');
  return parsed.data;
}
