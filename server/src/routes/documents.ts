import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import {
  DEFAULT_LIMITS,
  DocumentDetailSchema,
  DocumentIdSchema,
  DocumentListResponseSchema,
  DocumentTextResponseSchema,
  UploadResponseSchema,
  type DocumentMeta,
  type RejectedFile,
} from '@mdw/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { DocumentsRepo } from '../db/repositories/documentsRepo.js';
import type { BufferStore } from '../storage/bufferStore.js';
import type { DocumentProcessor } from '../processing/index.js';
import { validateUpload, type IncomingFile } from '../upload/validation.js';

export interface DocumentsRouteDeps {
  documents: DocumentsRepo;
  buffers: BufferStore;
  processor: Pick<DocumentProcessor, 'enqueue'>;
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
  const { documents, buffers, processor, limits } = deps;
  const router = Router();

  const findOr404 = (id: string) => {
    const record = documents.getById(id);
    if (!record) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    return record;
  };

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

        // Rule: a file that fails upload validation is reported in this response and is NOT stored. The
        // document list therefore holds only accepted files. (The client's own pre-check rejects some files
        // before they reach the server, so storing only the server's rejections made the list inconsistent.)
        // A file that is accepted but later cannot be processed (corrupt PDF, image without OCR) is stored,
        // and shows as Failed or Unsupported in the list.
        if (result.ok) {
          documents.insert(result.meta, null);
          buffers.put(result.meta.id, file.buffer);
          accepted.push(result.meta);
          processor.enqueue(result.meta.id);
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

  // GET /api/documents/:id: metadata, parse info, warnings and a short preview. Never the full text.
  router.get('/:id', (req, res) => {
    const record = findOr404(parseId(req.params.id));
    const detail = DocumentDetailSchema.parse({
      ...record,
      pages: record.parseInfo.pages,
      rows: record.parseInfo.rows,
      columns: record.parseInfo.columns,
      warnings: record.parseInfo.warnings,
      preview:
        record.extractedText === null ? null : record.extractedText.slice(0, DEFAULT_LIMITS.previewChars),
    });
    res.json(detail);
  });

  // GET /api/documents/:id/text: full extracted text, for the provenance view. Only after processing.
  router.get('/:id/text', (req, res) => {
    const record = findOr404(parseId(req.params.id));
    if (record.status !== 'processed' || record.extractedText === null) {
      throw new AppError(409, 'NOT_PROCESSED', 'Text is available once processing has finished successfully.');
    }
    // Stored text is already capped at MAX_CHARS_PER_DOCUMENT, so the response size is bounded.
    res.json(
      DocumentTextResponseSchema.parse({
        documentId: record.id,
        text: record.extractedText,
        charCount: record.charCount,
        wasTruncated: record.wasTruncated,
      }),
    );
  });

  // DELETE /api/documents/:id: removes the row and the in-memory bytes.
  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    findOr404(id);
    // Analyses keep a record of which documents they used. Deleting one would drop its provenance rows.
    if (documents.isUsedByAnalysis(id)) {
      throw new AppError(
        409,
        'DOCUMENT_IN_USE',
        'This document is used by a saved analysis, so it cannot be deleted.',
      );
    }
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
