import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DocumentListResponseSchema, DocumentMetaSchema, UploadResponseSchema } from '@mdw/shared';
import { createTestApp } from '../testing/testApp.js';

describe('documents API (integration)', () => {
  let ctx: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    ctx = createTestApp({ maxFiles: 3 });
  });

  afterEach(() => {
    ctx.close();
  });

  it('accepts one valid TXT and reports one invalid file in the same request (partial success)', async () => {
    const res = await request(ctx.app)
      .post('/api/documents')
      .attach('files', Buffer.from('Applicant: Jane Doe', 'utf8'), {
        filename: 'application.txt',
        contentType: 'text/plain',
      })
      .attach('files', Buffer.from('MZ binary'), {
        filename: 'setup.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(200);
    const parsed = UploadResponseSchema.parse(res.body);
    expect(parsed.accepted).toHaveLength(1);
    expect(parsed.accepted[0]?.format).toBe('txt');
    expect(parsed.accepted[0]?.status).toBe('uploaded');
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0]?.code).toBe('UNSUPPORTED_EXTENSION');
    expect(parsed.rejected[0]?.originalName).toBe('setup.exe');

    // Both files are stored. Only the accepted one has bytes and was queued for processing.
    expect(ctx.documents.list()).toHaveLength(2);
    expect(ctx.buffers.size()).toBe(1);
    expect(ctx.enqueued).toEqual([parsed.accepted[0]?.id]);
  });

  it('returns metadata only from GET /api/documents and GET /api/documents/:id', async () => {
    const upload = await request(ctx.app)
      .post('/api/documents')
      .attach('files', Buffer.from('a,b\n1,2\n'), { filename: 'fin.csv', contentType: 'text/csv' });
    const id = UploadResponseSchema.parse(upload.body).accepted[0]?.id ?? '';

    const list = await request(ctx.app).get('/api/documents');
    expect(list.status).toBe(200);
    expect(DocumentListResponseSchema.parse(list.body).documents).toHaveLength(1);
    expect(list.body.documents[0]).not.toHaveProperty('extractedText');

    const one = await request(ctx.app).get(`/api/documents/${id}`);
    expect(one.status).toBe(200);
    expect(DocumentMetaSchema.parse(one.body).id).toBe(id);
  });

  it('validates the id and returns 404 for an unknown document', async () => {
    const bad = await request(ctx.app).get('/api/documents/not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ID');

    const missing = await request(ctx.app).get('/api/documents/3f2c8a4e-1b7d-4c9e-8f20-5a6b7c8d9e0f');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('deletes a document from the DB and the buffer store', async () => {
    const upload = await request(ctx.app)
      .post('/api/documents')
      .attach('files', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    const id = UploadResponseSchema.parse(upload.body).accepted[0]?.id ?? '';

    const del = await request(ctx.app).delete(`/api/documents/${id}`);
    expect(del.status).toBe(204);
    expect(ctx.documents.getById(id)).toBeNull();
    expect(ctx.buffers.get(id)).toBeUndefined();

    const again = await request(ctx.app).delete(`/api/documents/${id}`);
    expect(again.status).toBe(404);
  });

  it('rejects too many files with 413 and the ApiError envelope', async () => {
    const res = await request(ctx.app)
      .post('/api/documents')
      .attach('files', Buffer.from('1'), { filename: 'a.txt', contentType: 'text/plain' })
      .attach('files', Buffer.from('2'), { filename: 'b.txt', contentType: 'text/plain' })
      .attach('files', Buffer.from('3'), { filename: 'c.txt', contentType: 'text/plain' })
      .attach('files', Buffer.from('4'), { filename: 'd.txt', contentType: 'text/plain' });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('TOO_MANY_FILES');
    expect(res.body.error).not.toHaveProperty('stack');
  });

  it('rejects a non-multipart upload with 415', async () => {
    const res = await request(ctx.app).post('/api/documents').send({ files: [] });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a multipart request with no files with 400', async () => {
    const res = await request(ctx.app)
      .post('/api/documents')
      .field('note', 'no files here');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_FILES');
  });
});
