import Papa from 'papaparse';
import { finalizeParsedDocument } from '../finalize.js';
import { decodeUtf8 } from './decode.js';
import { DocumentParseError, type DocumentParser } from './types.js';

/** Rows beyond this are not included in the text. The total count is still reported. */
export const MAX_CSV_ROWS = 500;

type CsvRow = Record<string, string | undefined>;

/**
 * Turns a CSV into labelled text so the model sees field names next to values:
 *   Columns: name, address, revenue
 *   Row 1: name=Jane Doe; address=12 High St; revenue=(empty)
 */
export const csvParser: DocumentParser = {
  format: 'csv',
  async parse(buffer, meta, options) {
    const text = decodeUtf8(buffer).replace(/^﻿/, '');
    const parsed = Papa.parse<CsvRow>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
    });

    const columns = (parsed.meta.fields ?? []).filter((name) => name.length > 0);
    if (columns.length === 0) {
      throw new DocumentParseError('The CSV has no header row with column names.');
    }

    const rows = parsed.data;
    if (rows.length === 0) {
      throw new DocumentParseError('The CSV has a header but no data rows.');
    }

    const warnings: string[] = [];
    const mismatched = parsed.errors.filter((e) => e.type === 'FieldMismatch').length;
    if (mismatched > 0) {
      warnings.push(`${mismatched} row(s) had a different number of fields than the header.`);
    }
    const other = parsed.errors.length - mismatched;
    if (other > 0) {
      warnings.push(`${other} line(s) could not be parsed cleanly and may be incomplete.`);
    }

    const included = rows.slice(0, MAX_CSV_ROWS);
    if (rows.length > MAX_CSV_ROWS) {
      warnings.push(`Only the first ${MAX_CSV_ROWS} of ${rows.length} rows were included in the text.`);
    }

    const lines = [`Columns: ${columns.join(', ')}`];
    included.forEach((row, i) => {
      const pairs = columns.map((column) => {
        const value = (row[column] ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
        return `${column}=${value.length > 0 ? value : '(empty)'}`;
      });
      lines.push(`Row ${i + 1}: ${pairs.join('; ')}`);
    });

    return finalizeParsedDocument({
      documentId: meta.id,
      format: 'csv',
      rawText: lines.join('\n'),
      pages: null,
      rows: rows.length,
      columns,
      warnings,
      maxChars: options.maxChars,
    });
  },
};
