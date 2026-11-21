import type { DocumentFormat, DocumentMeta, ParsedDocument } from '@mdw/shared';

export interface ParseOptions {
  /** MAX_CHARS_PER_DOCUMENT. Applied after normalisation. */
  maxChars: number;
}

/** One parser per format, behind this single interface. */
export interface DocumentParser {
  readonly format: DocumentFormat;
  parse(buffer: Buffer, meta: DocumentMeta, options: ParseOptions): Promise<ParsedDocument>;
}

/** No parser exists for this format. The document is marked "unsupported". */
export class UnsupportedFormatError extends Error {
  constructor(readonly format: string) {
    super(`Text extraction is not available for "${format}" files yet.`);
    this.name = 'UnsupportedFormatError';
  }
}

/** The file could not be read. The message is safe to show to the user. */
export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentParseError';
  }
}
