import { finalizeParsedDocument } from '../finalize.js';
import { decodeUtf8 } from './decode.js';
import type { DocumentParser } from './types.js';

export const txtParser: DocumentParser = {
  format: 'txt',
  async parse(buffer, meta, options) {
    return finalizeParsedDocument({
      documentId: meta.id,
      format: 'txt',
      rawText: decodeUtf8(buffer),
      pages: null,
      rows: null,
      columns: null,
      warnings: [],
      maxChars: options.maxChars,
    });
  },
};
