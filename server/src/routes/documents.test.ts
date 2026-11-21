import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DocumentListResponseSchema, DocumentMetaSchema, UploadResponseSchema } from '@mdw/shared';
import { createTestApp } from '../testing/testApp.js';
import { makeCsv, makeTextPdf } from '../testing/fixtures.js';

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

    // Both rows are stored. The accepted file is processed in the background.
    expect(ctx.documents.list()).toHaveLength(2);
    await ctx.processor.whenIdle();
    const stored = ctx.documents.getById(parsed.accepted[0]?.id ?? '');
    expect(stored?.status).toBe('processed');
    expect(stored?.extractedText).toBe('Applicant: Jane Doe');
    // Raw bytes are freed after processing.
    expect(ctx.buffers.size()).toBe(0);
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

  it('processes a CSV: detail has columns, rows and a preview; /text returns labelled rows', async () => {
    const upload = await request(ctx.app)
      .post('/api/documents')
      .attach('files', Buffer.from(makeCsv(['name', 'revenue'], 3)), {
        filename: 'financials.csv',
        contentType: 'text/csv',
      });
    const id = UploadResponseSchema.parse(upload.body).accepted[0]?.id ?? '';
    await ctx.processor.whenIdle();

    const detail = await request(ctx.app).get(`/api/documents/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('processed');
    expect(detail.body.columns).toEqual(['name', 'revenue']);
    expect(detail.body.rows).toBe(3);
    expect(detail.body.preview).toContain('Row 1: name=name-1; revenue=revenue-1');
    expect(detail.body).not.toHaveProperty('extractedText');

    const text = await request(ctx.app).get(`/api/documents/${id}/text`);
    expect(text.status).toBe(200);
    expect(text.body.text).toContain('Row 3: name=name-3; revenue=revenue-3');
    expect(text.body.wasTruncated).toBe(false);
  });

  it('processes a valid PDF fixture into text', async () => {
    const upload = await request(ctx.app)
      .post('/api/documents')
      .attach('files', makeTextPdf('Applicant: Jane Doe'), {
        filename: 'application.pdf',
        contentType: 'application/pdf',
      });
    const id = UploadResponseSchema.parse(upload.body).accepted[0]?.id ?? '';
    await ctx.processor.whenIdle();

    const text = await request(ctx.app).get(`/api/documents/${id}/text`);
    expect(text.status).toBe(200);
    expect(text.body.text).toContain('Applicant: Jane Doe');
  });

  it('marks a corrupted PDF as failed with a readable message, and the server keeps running', async () => {
    const corrupted = Buffer.from('%PDF-1.4 this is not a real pdf body, just junk bytes');
    const upload = await request(ctx.app)
      .post('/api/documents')
      .attach('files', corrupted, { filename: 'broken.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(200);
    const id = UploadResponseSchema.parse(upload.body).accepted[0]?.id ?? '';
    await ctx.processor.whenIdle();

    const detail = await request(ctx.app).get(`/api/documents/${id}`);
    expect(detail.body.status).toBe('failed');
    expect(typeof detail.body.errorMessage).toBe('string');
    expect(detail.body.errorMessage).not.toMatch(/at .*\.js:\d+/); // no stack trace text

    // The server still answers after the failure.
    const health = await request(ctx.app).get('/api/health');
    expect(health.status).toBe(200);
  });

  it('marks an image as unsupported (no OCR yet) and returns 409 for its text', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const upload = await request(ctx.app)
      .post('/api/documents')
      .attach('files', png, { filename: 'scan.png', contentType: 'image/png' });
    const id = UploadResponseSchema.parse(upload.body).accepted[0]?.id ?? '';
    await ctx.processor.whenIdle();

    const detail = await request(ctx.app).get(`/api/documents/${id}`);
    expect(detail.body.status).toBe('unsupported');
    expect(detail.body.errorMessage).toContain('not available');

    const text = await request(ctx.app).get(`/api/documents/${id}/text`);
    expect(text.status).toBe(409);
    expect(text.body.error.code).toBe('NOT_PROCESSED');
  });

  it('keeps a batch going when one file is corrupt: the good file is processed, the bad one fails', async () => {
    const upload = await request(ctx.app)
      .post('/api/documents')
      .attach('files', Buffer.from('%PDF-1.4 junk junk junk'), { filename: 'broken.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('Revenue: 100'), { filename: 'notes.txt', contentType: 'text/plain' });
    const accepted = UploadResponseSchema.parse(upload.body).accepted;
    await ctx.processor.whenIdle();

    const statuses = accepted.map((doc) => ctx.documents.getById(doc.id)?.status);
    expect(statuses.sort()).toEqual(['failed', 'processed']);

    const good = accepted.find((doc) => doc.format === 'txt');
    const goodText = await request(ctx.app).get(`/api/documents/${good?.id ?? ''}/text`);
    expect(goodText.status).toBe(200);
    expect(goodText.body.text).toBe('Revenue: 100');
  });
});
