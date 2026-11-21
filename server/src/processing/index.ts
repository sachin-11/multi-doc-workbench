import { logger } from '../lib/logger.js';

/**
 * Hook for document processing (M4: parse text, chunk, store extracted_text, set status).
 * Called once per accepted upload. Currently it only logs and does not change the document.
 */
export function enqueueProcessing(documentId: string): void {
  logger.info('processing queued (placeholder until M4)', { documentId });
}
