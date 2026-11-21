import { DocumentParseError } from './types.js';

/** Strict UTF-8 decode. Throws DocumentParseError instead of producing replacement characters. */
export function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new DocumentParseError('The file is not valid UTF-8 text.');
  }
}
