import path from 'node:path';
import {
  EXTENSION_TO_FORMAT,
  MIME_TO_FORMAT,
  type DocumentFormat,
  type DocumentMeta,
  type DocumentStatus,
  type UploadRejectionCode,
} from '@mdw/shared';

/*
 * Pure validation for uploaded files. No I/O, no Express types, so every rule is unit-testable.
 * One bad file never throws. It returns { ok: false } and the route reports it.
 */

export interface IncomingFile {
  /** Name as sent by the client. Untrusted. */
  originalName: string;
  /** Content-Type declared by the client. Untrusted. */
  declaredMimeType: string;
  buffer: Buffer;
}

export interface ValidationIds {
  id: string;
  createdAt: string;
}

export type ValidationResult =
  | { ok: true; meta: DocumentMeta }
  | {
      ok: false;
      code: UploadRejectionCode;
      reason: string;
      /** Metadata to store with status "unsupported" or "failed". */
      meta: DocumentMeta;
    };

const MAX_DISPLAY_NAME_CHARS = 255;
const MAX_STEM_CHARS = 100;
const MAX_EXT_CHARS = 10;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** Last path segment, with control characters removed. Handles both / and \ separators. */
function lastSegment(rawName: string): string {
  const segment = rawName.split(/[\\/]/).pop() ?? '';
  return segment.replace(CONTROL_CHARS, '').trim();
}

/** Human-readable name kept for display only. Never used in a filesystem path. */
export function displayName(rawName: string): string {
  const cleaned = lastSegment(rawName).slice(0, MAX_DISPLAY_NAME_CHARS);
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/**
 * Safe name: only [A-Za-z0-9._-], no leading dots (no hidden files), no path segments,
 * lower-case extension from a short allowlist of characters.
 */
export function sanitizeFilename(rawName: string): string {
  const segment = lastSegment(rawName);
  const dot = segment.lastIndexOf('.');
  const rawStem = dot > 0 ? segment.slice(0, dot) : segment;
  const rawExt = dot > 0 ? segment.slice(dot + 1) : '';

  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_EXT_CHARS);
  const stem = rawStem
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .slice(0, MAX_STEM_CHARS)
    .replace(/[._-]+$/, '');

  const safeStem = stem.length > 0 ? stem : 'document';
  return ext.length > 0 ? `${safeStem}.${ext}` : safeStem;
}

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

/** UTF-8 text with no NUL bytes. Binary data is rejected even when it happens to decode. */
export function isCleanUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0x00)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/** Magic-byte check for binary formats. Text formats are checked by isCleanUtf8Text. */
export function matchesMagicBytes(format: DocumentFormat, ext: string, buffer: Buffer): boolean {
  switch (format) {
    case 'pdf':
      return startsWith(buffer, PDF_MAGIC);
    case 'image':
      return ext === '.png' ? startsWith(buffer, PNG_MAGIC) : startsWith(buffer, JPEG_MAGIC);
    case 'txt':
    case 'csv':
      return isCleanUtf8Text(buffer);
  }
}

/**
 * Validates one file. Checks run in this order: extension, declared MIME, empty file,
 * content (magic bytes or UTF-8). The first failing check wins.
 */
export function validateUpload(file: IncomingFile, ids: ValidationIds): ValidationResult {
  const originalName = displayName(file.originalName);
  const sanitizedName = sanitizeFilename(file.originalName);
  const ext = path.extname(sanitizedName).toLowerCase();
  const format = EXTENSION_TO_FORMAT[ext] ?? null;
  const declaredMime = file.declaredMimeType.trim().toLowerCase() || 'application/octet-stream';
  const sizeBytes = file.buffer.byteLength;

  const base = {
    id: ids.id,
    originalName,
    sanitizedName,
    mimeType: declaredMime,
    format,
    sizeBytes,
    charCount: 0,
    wasTruncated: false,
    createdAt: ids.createdAt,
  };

  const reject = (
    code: UploadRejectionCode,
    status: Extract<DocumentStatus, 'unsupported' | 'failed'>,
    reason: string,
  ): ValidationResult => ({
    ok: false,
    code,
    reason,
    meta: { ...base, status, errorMessage: reason },
  });

  if (format === null) {
    return reject(
      'UNSUPPORTED_EXTENSION',
      'unsupported',
      `File type "${ext || '(none)'}" is not supported. Allowed: .pdf, .txt, .csv, .png, .jpg, .jpeg.`,
    );
  }

  if (MIME_TO_FORMAT[declaredMime] !== format) {
    return reject(
      'MIME_MISMATCH',
      'unsupported',
      `Declared type "${declaredMime}" does not match the "${ext}" file extension.`,
    );
  }

  if (sizeBytes === 0) {
    return reject('EMPTY_FILE', 'failed', 'File is empty.');
  }

  if (format === 'txt' || format === 'csv') {
    if (!isCleanUtf8Text(file.buffer)) {
      return reject(
        'INVALID_TEXT',
        'failed',
        'Text files must be valid UTF-8 without binary content.',
      );
    }
  } else if (!matchesMagicBytes(format, ext, file.buffer)) {
    return reject(
      'SIGNATURE_MISMATCH',
      'failed',
      `File content does not match a valid ${ext} file.`,
    );
  }

  return {
    ok: true,
    meta: { ...base, format, status: 'uploaded', errorMessage: null },
  };
}
