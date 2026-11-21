import { describe, expect, it } from 'vitest';
import { chunkText, normalizeText, truncateText } from './text.js';
import { finalizeParsedDocument } from './finalize.js';

const DOC_ID = '3f2c8a4e-1b7d-4c9e-8f20-5a6b7c8d9e0f';

describe('normalizeText', () => {
  it('normalises CRLF, collapses spaces, keeps paragraph breaks, strips control characters', () => {
    const raw = '﻿First   line\r\n\r\n\r\n\r\nSecond\tline\u0007 here\r\n';
    expect(normalizeText(raw)).toBe('First line\n\nSecond line here');
  });
});

describe('truncateText', () => {
  it('leaves short text alone', () => {
    expect(truncateText('short', 100)).toEqual({ text: 'short', wasTruncated: false });
  });

  it('cuts long text at a word boundary and flags it', () => {
    const text = 'word '.repeat(50).trim();
    const result = truncateText(text, 60);

    expect(result.wasTruncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(60);
    expect(result.text.endsWith('word')).toBe(true);
  });
});

describe('chunkText', () => {
  // Deterministic prose-like text with sentence and paragraph breaks.
  const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join(' ') +
    '\n\n' +
    Array.from({ length: 300 }, (_, i) => `Paragraph two line ${i}.`).join('\n');

  it('returns no chunks for empty text and one chunk for short text', () => {
    expect(chunkText('')).toEqual([]);
    const single = chunkText('hello world');
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ index: 0, startChar: 0, endChar: 11, text: 'hello world' });
  });

  it('records offsets that match the text, and covers every character', () => {
    const chunks = chunkText(text, { targetChars: 1000, overlapChars: 100 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
      expect(text.slice(chunk.startChar, chunk.endChar)).toBe(chunk.text);
    });

    // Every character index is inside at least one chunk.
    const covered = new Uint8Array(text.length);
    for (const chunk of chunks) covered.fill(1, chunk.startChar, chunk.endChar);
    expect(covered.every((v) => v === 1)).toBe(true);

    // The last chunk ends at the end of the text.
    expect(chunks[chunks.length - 1]?.endChar).toBe(text.length);
  });

  it('keeps chunks near the target size and overlaps neighbours', () => {
    const chunks = chunkText(text, { targetChars: 1000, overlapChars: 100 });
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1000);
    }
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      const curr = chunks[i];
      expect(curr && prev && curr.startChar < prev.endChar).toBe(true);
    }
  });

  it('rejects an overlap that is not smaller than the target', () => {
    expect(() => chunkText('abc', { targetChars: 10, overlapChars: 10 })).toThrow(RangeError);
  });
});

describe('finalizeParsedDocument', () => {
  it('truncates per document, sets wasTruncated and adds a warning', () => {
    const parsed = finalizeParsedDocument({
      documentId: DOC_ID,
      format: 'txt',
      rawText: 'alpha beta gamma delta epsilon zeta eta theta '.repeat(100),
      pages: null,
      rows: null,
      columns: null,
      warnings: [],
      maxChars: 1000,
    });

    expect(parsed.wasTruncated).toBe(true);
    expect(parsed.charCount).toBeLessThanOrEqual(1000);
    expect(parsed.text.length).toBe(parsed.charCount);
    expect(parsed.warnings.some((w) => w.includes('truncated'))).toBe(true);
    expect(parsed.chunks.length).toBeGreaterThan(0);
  });

  it('does not flag short documents', () => {
    const parsed = finalizeParsedDocument({
      documentId: DOC_ID,
      format: 'txt',
      rawText: 'short note',
      pages: null,
      rows: null,
      columns: null,
      warnings: [],
      maxChars: 1000,
    });

    expect(parsed.wasTruncated).toBe(false);
    expect(parsed.warnings).toEqual([]);
  });
});
