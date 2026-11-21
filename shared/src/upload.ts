import { z } from 'zod';
import { DocumentMetaSchema } from './documents.js';

/** Why a single file was rejected. The request itself can still succeed (partial success). */
export const UploadRejectionCodeSchema = z.enum([
  'EMPTY_FILE',
  'UNSUPPORTED_EXTENSION',
  'MIME_MISMATCH',
  'SIGNATURE_MISMATCH',
  'INVALID_TEXT',
]);
export type UploadRejectionCode = z.infer<typeof UploadRejectionCodeSchema>;

export const RejectedFileSchema = z.object({
  originalName: z.string(),
  code: UploadRejectionCodeSchema,
  reason: z.string(),
});
export type RejectedFile = z.infer<typeof RejectedFileSchema>;

/** Response of POST /api/documents. Accepted and rejected files are both reported. */
export const UploadResponseSchema = z.object({
  accepted: z.array(DocumentMetaSchema),
  rejected: z.array(RejectedFileSchema),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

/** Response of GET /api/documents. Metadata only, never raw text or buffers. */
export const DocumentListResponseSchema = z.object({
  documents: z.array(DocumentMetaSchema),
});
export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

/** Validates the :id route parameter. */
export const DocumentIdSchema = z.uuid();
