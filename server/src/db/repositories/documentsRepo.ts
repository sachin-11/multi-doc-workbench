import {
  DocumentMetaSchema,
  type DocumentFormat,
  type DocumentMeta,
  type DocumentStatus,
} from '@mdw/shared';
import {
  DocumentParseInfoSchema,
  type DocumentParseInfo,
  type ParsedDocument,
} from '@mdw/shared';
import type { Db } from '../client.js';

/** Document metadata plus the stored text. Text is server-only and never sent to clients by default. */
export interface DocumentRecord extends DocumentMeta {
  extractedText: string | null;
  parseInfo: DocumentParseInfo;
}

const EMPTY_PARSE_INFO: DocumentParseInfo = { pages: null, rows: null, columns: null, warnings: [] };

interface DocumentRow {
  id: string;
  original_name: string;
  sanitized_name: string;
  mime_type: string;
  format: string | null;
  size_bytes: number;
  status: string;
  error_message: string | null;
  extracted_text: string | null;
  char_count: number;
  was_truncated: number;
  parse_info_json: string | null;
  created_at: string;
}

function rowToMeta(row: DocumentRow): DocumentMeta {
  // Zod validates the mapped object, so an unexpected DB value fails loudly here.
  return DocumentMetaSchema.parse({
    id: row.id,
    originalName: row.original_name,
    sanitizedName: row.sanitized_name,
    mimeType: row.mime_type,
    format: row.format as DocumentFormat | null,
    sizeBytes: row.size_bytes,
    status: row.status as DocumentStatus,
    errorMessage: row.error_message,
    charCount: row.char_count,
    wasTruncated: row.was_truncated === 1,
    createdAt: row.created_at,
  });
}

function parseInfoFromJson(json: string | null): DocumentParseInfo {
  if (json === null) return EMPTY_PARSE_INFO;
  const raw: unknown = JSON.parse(json);
  return DocumentParseInfoSchema.parse(raw);
}

function rowToRecord(row: DocumentRow): DocumentRecord {
  return {
    ...rowToMeta(row),
    extractedText: row.extracted_text,
    parseInfo: parseInfoFromJson(row.parse_info_json),
  };
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
  const deleteStmt = db.prepare(`DELETE FROM documents WHERE id = ?`);
  const usedByAnalysisStmt = db.prepare<[string], { found: number }>(
    `SELECT 1 AS found FROM analysis_documents WHERE document_id = ? LIMIT 1`,
  );
  const saveParsedStmt = db.prepare(`
    UPDATE documents SET
      status = 'processed',
      error_message = NULL,
      extracted_text = @text,
      char_count = @charCount,
      was_truncated = @wasTruncated,
      parse_info_json = @parseInfoJson
    WHERE id = @id`);
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

    /** Metadata only. Extracted text is never included in list results. */
    list(): DocumentMeta[] {
      return (listStmt.all() as DocumentRow[]).map((row) => rowToMeta(row));
    },

    /** True when at least one analysis used this document. Such documents cannot be deleted (see DELETE route). */
    isUsedByAnalysis(id: string): boolean {
      return usedByAnalysisStmt.get(id) !== undefined;
    },

    /** Deletes a document row. Returns false when no row matched. */
    delete(id: string): boolean {
      return deleteStmt.run(id).changes > 0;
    },

    /** Stores the parser output and marks the document processed, in one statement. */
    saveParsed(id: string, parsed: ParsedDocument): void {
      saveParsedStmt.run({
        id,
        text: parsed.text,
        charCount: parsed.charCount,
        wasTruncated: parsed.wasTruncated ? 1 : 0,
        parseInfoJson: JSON.stringify(
          DocumentParseInfoSchema.parse({
            pages: parsed.pages,
            rows: parsed.rows,
            columns: parsed.columns,
            warnings: parsed.warnings,
          }),
        ),
      });
    },

    updateStatus(id: string, status: DocumentStatus, errorMessage: string | null = null): void {
      updateStatusStmt.run({ id, status, errorMessage });
    },
  };
}

export type DocumentsRepo = ReturnType<typeof createDocumentsRepo>;
