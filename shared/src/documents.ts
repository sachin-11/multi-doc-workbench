import { z } from 'zod';

/** Document formats the pipeline can handle. `image` is reserved for optional OCR (stretch). */
export const DocumentFormatSchema = z.enum(['pdf', 'txt', 'csv', 'image']);
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;

export const DocumentStatusSchema = z.enum([
  'uploaded',
  'processing',
  'processed',
  'failed',
  'unsupported',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

/** Metadata about an uploaded document. Never contains raw file content. */
export const DocumentMetaSchema = z.object({
  id: z.uuid(),
  originalName: z.string().min(1).max(255),
  sanitizedName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  format: DocumentFormatSchema,
  sizeBytes: z.number().int().nonnegative(),
  status: DocumentStatusSchema,
  errorMessage: z.string().nullable(),
  charCount: z.number().int().nonnegative(),
  wasTruncated: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
