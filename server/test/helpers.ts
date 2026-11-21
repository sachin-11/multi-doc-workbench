import type { Express } from 'express';
import request from 'supertest';
import { DocumentDetailSchema, type DocumentDetail } from '@mdw/shared';

/**
 * Polls GET /api/documents/:id until processing has finished (processed, failed or unsupported).
 * Throws if the document is still pending when the timeout expires, so a stuck pipeline fails the test
 * with a clear message instead of hanging.
 */
export async function waitForProcessing(app: Express, id: string, timeoutMs = 15_000): Promise<DocumentDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(`/api/documents/${id}`);
    if (res.status !== 200) {
      throw new Error(`GET /api/documents/${id} returned ${res.status}`);
    }
    const detail = DocumentDetailSchema.parse(res.body);
    if (detail.status !== 'uploaded' && detail.status !== 'processing') {
      return detail;
    }
    if (Date.now() > deadline) {
      throw new Error(`Document ${id} still "${detail.status}" after ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
