import { DocumentFormatSchema, type DocumentFormat } from './documents.js';

export const SUPPORTED_FORMATS = DocumentFormatSchema.options;

/** MIME type -> format. Unknown MIME types are rejected in upload validation (M3). */
export const MIME_TO_FORMAT: Readonly<Record<string, DocumentFormat>> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/csv': 'csv',
  // Windows browsers often send CSV files with this type.
  'application/vnd.ms-excel': 'csv',
  'image/png': 'image',
  'image/jpeg': 'image',
};

/** Lower-case extension (with dot) -> format. Checked together with MIME type. */
export const EXTENSION_TO_FORMAT: Readonly<Record<string, DocumentFormat>> = {
  '.pdf': 'pdf',
  '.txt': 'txt',
  '.csv': 'csv',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
};

/** Default limits. Runtime values come from env (server/src/config/env.ts); these are fallbacks and schema bounds. */
export const DEFAULT_LIMITS = {
  maxFileSizeMb: 5,
  maxFiles: 10,
  maxDocumentsPerAnalysis: 10,
  minInstructionChars: 5,
  maxInstructionChars: 2000,
  maxSnippetChars: 200,
} as const;
