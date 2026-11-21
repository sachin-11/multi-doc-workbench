import { PDFParse } from 'pdf-parse';
import { finalizeParsedDocument } from '../finalize.js';
import { DocumentParseError, type DocumentParser } from './types.js';

/** Below this many non-whitespace characters the PDF is treated as having no usable text layer. */
const MIN_EXTRACTABLE_CHARS = 20;

export const pdfParser: DocumentParser = {
  format: 'pdf',
  async parse(buffer, meta, options) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      let result;
      try {
        result = await parser.getText();
      } catch {
        throw new DocumentParseError('This PDF could not be read. It may be corrupted or password-protected.');
      }

      const usableChars = result.text.replace(/\s/g, '').length;
      if (usableChars < MIN_EXTRACTABLE_CHARS) {
        throw new DocumentParseError(
          'No extractable text was found. This may be a scanned PDF, and OCR is not supported yet.',
        );
      }

      return finalizeParsedDocument({
        documentId: meta.id,
        format: 'pdf',
        rawText: result.text,
        pages: result.total,
        rows: null,
        columns: null,
        warnings: [],
        maxChars: options.maxChars,
      });
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  },
};
