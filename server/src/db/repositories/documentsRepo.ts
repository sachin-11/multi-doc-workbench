import {
  DocumentMetaSchema,
  type DocumentFormat,
  type DocumentMeta,
  type DocumentStatus,
} from '@mdw/shared';
import type { Db } from '../client.js';

/** Document metadata plus the stored text. Text is server-only and never sent to clients by default. */
export interface DocumentRecord extends DocumentMeta {
  extractedText: string | null;
}

interface DocumentRow {
  id: string;
  original_name: string;
  sanitized_name: string;
  mime_type: string;
  format: string;
  size_bytes: number;
  status: string;
  error_message: string | null;
  extracted_text: string | null;
  char_count: number;
  was_truncated: number;
  created_at: string;
}

function rowToRecord(row: DocumentRow): DocumentRecord {
  // Zod validates the mapped object, so an unexpected DB value fails loudly here.
  const meta = DocumentMetaSchema.parse({
    id: row.id,
    originalName: row.original_name,
    sanitizedName: row.sanitized_name,
    mimeType: row.mime_type,
    format: row.format as DocumentFormat,
    sizeBytes: row.size_bytes,
    status: row.status as DocumentStatus,
    errorMessage: row.error_message,
    charCount: row.char_count,
    wasTruncated: row.was_truncated === 1,
    createdAt: row.created_at,
  });
  return { ...meta, extractedText: row.extracted_text };
}

export function createDocumentsRepo(db: Db) {
  const insertStmt = db.prepare(`
    INSERT INTO documents (
      id, original_name, sanitized_name, mime_type, format, size_bytes,
      status, error_message, extracted_text, char_count, was_truncated, created_at
    ) VALUES (
      @id, @originalName, @sanitizedName, @mimeType, @format, @sizeBytes,
      @status, @errorMessage, @extractedText, @charCount, @wasTruncated, @createdAt
    )`);

  const getByIdStmt = db.prepare<[string], DocumentRow>(`SELECT * FROM documents WHERE id = ?`);
  const listStmt = db.prepare<[], DocumentRow>(`SELECT * FROM documents ORDER BY created_at DESC`);
  const updateStatusStmt = db.prepare(
    `UPDATE documents SET status = @status, error_message = @errorMessage WHERE id = @id`,
  );

  return {
    /** Inserts a document. Metadata is validated before writing. */
    insert(meta: DocumentMeta, extractedText: string | null): void {
      const valid = DocumentMetaSchema.parse(meta);
      insertStmt.run({
        ...valid,
        extractedText,
        wasTruncated: valid.wasTruncated ? 1 : 0,
      });
    },

    getById(id: string): DocumentRecord | null {
      const row = getByIdStmt.get(id) as DocumentRow | undefined;
      return row ? rowToRecord(row) : null;
    },

    list(): DocumentMeta[] {
      return (listStmt.all() as DocumentRow[]).map((row) => rowToRecord(row));
    },

    updateStatus(id: string, status: DocumentStatus, errorMessage: string | null = null): void {
      updateStatusStmt.run({ id, status, errorMessage });
    },
  };
}

export type DocumentsRepo = ReturnType<typeof createDocumentsRepo>;
