import { randomUUID } from 'node:crypto';
import type { DocumentMeta, ParsedDocument } from '@mdw/shared';
import type { DocumentsRepo } from '../db/repositories/documentsRepo.js';
import { chunkText, normalizeText } from '../processing/text.js';

const NOW = '2026-11-21T10:00:00.000Z';

/**
 * Inserts a document as the processing pipeline would leave it: processed, with stored text and chunks.
 * Test-only. It skips upload and parsing, so a test can set up documents in one line.
 */
export function insertProcessed(ctx: { documents: Pick<DocumentsRepo, 'insert' | 'saveParsed'> }, name: string, text: string): string {
  const id = randomUUID();
  const meta: DocumentMeta = {
    id,
    originalName: name,
    sanitizedName: name,
    mimeType: 'text/plain',
    format: 'txt',
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    status: 'uploaded',
    errorMessage: null,
    charCount: 0,
    wasTruncated: false,
    createdAt: NOW,
  };
  ctx.documents.insert(meta, null);
  const normalized = normalizeText(text);
  const parsed: ParsedDocument = {
    documentId: id,
    format: 'txt',
    text: normalized,
    pages: null,
    rows: null,
    columns: null,
    charCount: normalized.length,
    wasTruncated: false,
    chunks: chunkText(normalized),
    warnings: [],
  };
  ctx.documents.saveParsed(id, parsed);
  return id;
}
