import type { DocumentFormat } from '@mdw/shared';
import { csvParser } from './csvParser.js';
import { pdfParser } from './pdfParser.js';
import { txtParser } from './txtParser.js';
import { UnsupportedFormatError, type DocumentParser } from './types.js';

export interface ParserRegistry {
  get(format: DocumentFormat): DocumentParser;
}

/**
 * Maps each format to its parser. A format with no parser (image, until OCR exists) throws
 * UnsupportedFormatError, and the document is marked "unsupported".
 */
export function createParserRegistry(parsers: readonly DocumentParser[]): ParserRegistry {
  const byFormat = new Map<string, DocumentParser>(parsers.map((p) => [p.format, p]));
  return {
    get(format) {
      const parser = byFormat.get(format);
      if (!parser) throw new UnsupportedFormatError(format);
      return parser;
    },
  };
}

export const defaultParserRegistry = createParserRegistry([txtParser, pdfParser, csvParser]);
