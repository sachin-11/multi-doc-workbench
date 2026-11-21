import { z } from 'zod';
import { DocumentFormatSchema, DocumentMetaSchema } from './documents.js';

/** One bounded piece of a document's text. Offsets point into the stored (normalised, truncated) text. */
export const ChunkSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  startChar: z.number().int().nonnegative(),
  endChar: z.number().int().nonnegative(),
});
export type Chunk = z.infer<typeof ChunkSchema>;

/** Format-specific facts captured while parsing. Nulls where a format does not apply. */
export const DocumentParseInfoSchema = z.object({
  pages: z.number().int().nonnegative().nullable(),
  rows: z.number().int().nonnegative().nullable(),
  columns: z.array(z.string()).nullable(),
  warnings: z.array(z.string()),
});
export type DocumentParseInfo = z.infer<typeof DocumentParseInfoSchema>;

/** Output of a parser after normalisation, truncation and chunking. */
export const ParsedDocumentSchema = z.object({
  documentId: z.uuid(),
  format: DocumentFormatSchema,
  text: z.string(),
  pages: z.number().int().nonnegative().nullable(),
  rows: z.number().int().nonnegative().nullable(),
  columns: z.array(z.string()).nullable(),
  charCount: z.number().int().nonnegative(),
  wasTruncated: z.boolean(),
  chunks: z.array(ChunkSchema),
  warnings: z.array(z.string()),
});
export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;

/** GET /api/documents/:id: metadata plus parse info and a short preview. Never the full text. */
export const DocumentDetailSchema = DocumentMetaSchema.extend({
  pages: z.number().int().nonnegative().nullable(),
  rows: z.number().int().nonnegative().nullable(),
  columns: z.array(z.string()).nullable(),
  warnings: z.array(z.string()),
  preview: z.string().nullable(),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

/** GET /api/documents/:id/text: full extracted text for the provenance / debug view. */
export const DocumentTextResponseSchema = z.object({
  documentId: z.uuid(),
  text: z.string(),
  charCount: z.number().int().nonnegative(),
  wasTruncated: z.boolean(),
});
export type DocumentTextResponse = z.infer<typeof DocumentTextResponseSchema>;
