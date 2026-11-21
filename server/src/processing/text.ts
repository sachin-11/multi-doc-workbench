import type { Chunk } from '@mdw/shared';

/*
 * Pure text functions. No I/O, so they are unit-testable.
 * Chunk offsets are character indexes into the stored (normalised, truncated) text.
 */

export const CHUNK_TARGET_CHARS = 4000;
export const CHUNK_OVERLAP_CHARS = 200;

/** Removes BOM, normalises line endings, strips control characters, and collapses whitespace. Paragraph breaks are kept. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    // Remove control characters except tab and newline (already normalised above).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface TruncateResult {
  text: string;
  wasTruncated: boolean;
}

/** Cuts text at maxChars, preferring a word boundary near the cut. */
export function truncateText(text: string, maxChars: number): TruncateResult {
  if (text.length <= maxChars) return { text, wasTruncated: false };

  let cut = text.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  // Only backtrack when the boundary is close, so we do not throw away much text.
  if (lastBreak > maxChars - 200) cut = cut.slice(0, lastBreak);

  return { text: cut.trimEnd(), wasTruncated: true };
}

export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
}

/** Finds a split point between start+target/2 and end, preferring paragraph, line, sentence, then word breaks. */
function findBreak(text: string, start: number, end: number, target: number): number {
  const minEnd = start + Math.floor(target / 2);
  for (const separator of ['\n\n', '\n', '. ', ' ']) {
    const index = text.lastIndexOf(separator, end - separator.length);
    if (index >= minEnd) return index + separator.length;
  }
  return end;
}

/**
 * Splits text into chunks with overlap. Every character of the input belongs to at least one chunk,
 * and `text.slice(startChar, endChar) === chunk.text` holds for each chunk.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const target = options.targetChars ?? CHUNK_TARGET_CHARS;
  const overlap = options.overlapChars ?? CHUNK_OVERLAP_CHARS;
  if (target <= overlap) throw new RangeError('targetChars must be greater than overlapChars');

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + target, text.length);
    if (end < text.length) end = findBreak(text, start, end, target);

    chunks.push({
      index: chunks.length,
      text: text.slice(start, end),
      startChar: start,
      endChar: end,
    });

    if (end >= text.length) break;
    const nextStart = end - overlap;
    // Always move forward, so the loop terminates.
    start = nextStart > start ? nextStart : end;
  }
  return chunks;
}
