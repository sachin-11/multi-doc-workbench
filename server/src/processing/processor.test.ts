import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentMeta } from '@mdw/shared';
import { openDatabase, type Db } from '../db/client.js';
import { createDocumentsRepo, type DocumentsRepo } from '../db/repositories/documentsRepo.js';
import { createBufferStore, type BufferStore } from '../storage/bufferStore.js';
import { createDocumentProcessor } from './index.js';
import { createParserRegistry } from './parsers/registry.js';
import type { DocumentParser } from './parsers/types.js';

const NOW = '2026-11-21T10:00:00.000Z';

function insertDocument(documents: DocumentsRepo, format: DocumentMeta['format'], name: string): string {
  const id = randomUUID();
  documents.insert(
    {
      id,
      originalName: name,
      sanitizedName: name,
      mimeType: 'text/plain',
      format,
      sizeBytes: 5,
      status: 'uploaded',
      errorMessage: null,
      charCount: 0,
      wasTruncated: false,
      createdAt: NOW,
    },
    null,
  );
  return id;
}

describe('document processor', () => {
  let db: Db;
  let documents: DocumentsRepo;
  let buffers: BufferStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    documents = createDocumentsRepo(db);
    buffers = createBufferStore({ ttlMs: 60_000, sweepIntervalMs: 0 });
  });

  afterEach(() => {
    buffers.close();
    db.close();
  });

  it('fails a document whose bytes are gone, with a message the user can act on', async () => {
    const id = insertDocument(documents, 'txt', 'lost.txt');
    const processor = createDocumentProcessor({
      documents,
      buffers,
      options: { maxChars: 60_000, timeoutMs: 5_000, concurrency: 1 },
    });

    await processor.processNow(id);

    const record = documents.getById(id);
    expect(record?.status).toBe('failed');
    expect(record?.errorMessage).toContain('upload it again');
  });

  it('fails a document when the parser exceeds the timeout, and frees the bytes', async () => {
    const id = insertDocument(documents, 'txt', 'slow.txt');
    buffers.put(id, Buffer.from('hello'));

    const hangingParser: DocumentParser = {
      format: 'txt',
      parse: () => new Promise(() => undefined), // never settles
    };
    const processor = createDocumentProcessor({
      documents,
      buffers,
      parsers: createParserRegistry([hangingParser]),
      options: { maxChars: 60_000, timeoutMs: 30, concurrency: 1 },
    });

    await processor.processNow(id);

    const record = documents.getById(id);
    expect(record?.status).toBe('failed');
    expect(record?.errorMessage).toBe('Processing took too long and was stopped.');
    expect(buffers.get(id)).toBeUndefined();
  });

  it('hides unexpected error details behind a generic message', async () => {
    const id = insertDocument(documents, 'txt', 'boom.txt');
    buffers.put(id, Buffer.from('hello'));

    const brokenParser: DocumentParser = {
      format: 'txt',
      parse: () => Promise.reject(new Error('internal /secret/path/detail')),
    };
    const processor = createDocumentProcessor({
      documents,
      buffers,
      parsers: createParserRegistry([brokenParser]),
      options: { maxChars: 60_000, timeoutMs: 5_000, concurrency: 1 },
    });

    await processor.processNow(id);

    const record = documents.getById(id);
    expect(record?.status).toBe('failed');
    expect(record?.errorMessage).toBe('An unexpected error occurred while reading this file.');
    expect(record?.errorMessage).not.toContain('secret');
  });

  it('processes queued documents in the background and returns their text and chunks', async () => {
    const id = insertDocument(documents, 'txt', 'note.txt');
    buffers.put(id, Buffer.from('Applicant: Jane Doe\n\nRevenue: 100'));
    const processor = createDocumentProcessor({
      documents,
      buffers,
      options: { maxChars: 60_000, timeoutMs: 5_000, concurrency: 2 },
    });

    processor.enqueue(id);
    await processor.whenIdle();

    expect(documents.getById(id)?.status).toBe('processed');
    const parsed = processor.getParsedDocument(id);
    expect(parsed?.text).toBe('Applicant: Jane Doe\n\nRevenue: 100');
    expect(parsed?.chunks[0]).toMatchObject({ index: 0, startChar: 0 });
    expect(buffers.size()).toBe(0);
  });
});
