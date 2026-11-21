import { ParsedDocumentSchema, type DocumentFormat, type ParsedDocument } from '@mdw/shared';
import { chunkText, normalizeText, truncateText } from './text.js';

export interface FinalizeInput {
  documentId: string;
  format: DocumentFormat;
  /** Raw text as produced by the parser (not yet normalised). */
  rawText: string;
  pages: number | null;
  rows: number | null;
  columns: string[] | null;
  /** Warnings the parser already produced. Truncation warnings are added here. */
  warnings: string[];
  maxChars: number;
}

/**
 * Shared last step for every parser: normalise, truncate per document, chunk, and validate.
 * The result is what gets stored and what the analysis engine reads.
 */
export function finalizeParsedDocument(input: FinalizeInput): ParsedDocument {
  const normalized = normalizeText(input.rawText);
  const truncated = truncateText(normalized, input.maxChars);

  const warnings = [...input.warnings];
  if (truncated.wasTruncated) {
    warnings.push(
      `Text was truncated to ${truncated.text.length} characters (the document has ${normalized.length}). Content after that point was not analysed.`,
    );
  }

  return ParsedDocumentSchema.parse({
    documentId: input.documentId,
    format: input.format,
    text: truncated.text,
    pages: input.pages,
    rows: input.rows,
    columns: input.columns,
    charCount: truncated.text.length,
    wasTruncated: truncated.wasTruncated,
    chunks: chunkText(truncated.text),
    warnings,
  });
}
