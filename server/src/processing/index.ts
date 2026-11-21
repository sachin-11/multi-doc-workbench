import { ParsedDocumentSchema, type ParsedDocument } from '@mdw/shared';
import { logger } from '../lib/logger.js';
import type { DocumentsRepo } from '../db/repositories/documentsRepo.js';
import type { BufferStore } from '../storage/bufferStore.js';
import { defaultParserRegistry, type ParserRegistry } from './parsers/registry.js';
import { DocumentParseError, UnsupportedFormatError } from './parsers/types.js';
import { createTaskQueue, type TaskQueue } from './queue.js';
import { chunkText } from './text.js';

export interface ProcessorOptions {
  /** MAX_CHARS_PER_DOCUMENT */
  maxChars: number;
  /** PROCESSING_TIMEOUT_MS, per document */
  timeoutMs: number;
  /** PROCESSING_CONCURRENCY */
  concurrency: number;
}

export interface ProcessorDependencies {
  documents: DocumentsRepo;
  buffers: BufferStore;
  parsers?: ParserRegistry;
  options: ProcessorOptions;
}

export interface DocumentProcessor {
  /** Queues a document for background processing (called from the upload route). */
  enqueue(documentId: string): void;
  /** Processes one document now. Errors are stored on the document, never thrown. */
  processNow(documentId: string): Promise<void>;
  /** Resolves when the queue is empty. Tests and shutdown use this. */
  whenIdle(): Promise<void>;
  /** Text and chunks for a processed document, or null if it is not processed. */
  getParsedDocument(documentId: string): ParsedDocument | null;
}

class ProcessingTimeoutError extends Error {
  constructor() {
    super('Processing took too long and was stopped.');
    this.name = 'ProcessingTimeoutError';
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProcessingTimeoutError()), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Maps any failure to a document status and a message that is safe to show the user. */
function describeFailure(err: unknown): { status: 'unsupported' | 'failed'; message: string } {
  if (err instanceof UnsupportedFormatError) {
    return { status: 'unsupported', message: err.message };
  }
  if (err instanceof DocumentParseError || err instanceof ProcessingTimeoutError) {
    return { status: 'failed', message: err.message };
  }
  return { status: 'failed', message: 'An unexpected error occurred while reading this file.' };
}

export function createDocumentProcessor(deps: ProcessorDependencies): DocumentProcessor {
  const { documents, buffers, options } = deps;
  const parsers = deps.parsers ?? defaultParserRegistry;
  const queue: TaskQueue = createTaskQueue(options.concurrency);

  const processNow = async (documentId: string): Promise<void> => {
    const record = documents.getById(documentId);
    if (!record) return;

    const bytes = buffers.get(documentId);
    if (!bytes) {
      // Bytes are in memory only. They are gone after a restart or TTL eviction.
      documents.updateStatus(
        documentId,
        'failed',
        'The uploaded file is no longer available. Please upload it again.',
      );
      logger.warn('processing skipped, buffer missing', { documentId });
      return;
    }

    documents.updateStatus(documentId, 'processing');

    try {
      if (record.format === null) {
        throw new UnsupportedFormatError('unknown');
      }
      const parser = parsers.get(record.format);
      const parsed = await withTimeout(parser.parse(bytes, record, { maxChars: options.maxChars }), options.timeoutMs);
      documents.saveParsed(documentId, parsed);
      logger.info('document processed', {
        documentId,
        charCount: parsed.charCount,
        wasTruncated: parsed.wasTruncated,
      });
    } catch (err) {
      const failure = describeFailure(err);
      documents.updateStatus(documentId, failure.status, failure.message);
      logger.warn('document processing ended without text', {
        documentId,
        status: failure.status,
        reason: err instanceof Error ? err.name : 'unknown',
      });
    } finally {
      // The raw bytes are no longer needed after processing, whether it worked or not.
      buffers.delete(documentId);
    }
  };

  return {
    enqueue(documentId) {
      queue.push(() => processNow(documentId));
      logger.info('processing queued', { documentId });
    },

    processNow,

    whenIdle: () => queue.whenIdle(),

    getParsedDocument(documentId) {
      const record = documents.getById(documentId);
      if (!record || record.status !== 'processed' || record.extractedText === null || record.format === null) {
        return null;
      }
      const text = record.extractedText;
      return ParsedDocumentSchema.parse({
        documentId,
        format: record.format,
        text,
        pages: record.parseInfo.pages,
        rows: record.parseInfo.rows,
        columns: record.parseInfo.columns,
        charCount: text.length,
        wasTruncated: record.wasTruncated,
        // Recomputed from the stored text with fixed chunk settings, so offsets are deterministic.
        chunks: chunkText(text),
        warnings: record.parseInfo.warnings,
      });
    },
  };
}
