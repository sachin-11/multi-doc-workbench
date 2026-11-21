import { describe, expect, it } from 'vitest';
import type { DocumentMeta } from '@mdw/shared';
import { makeCsv, makeTextPdf } from '../../testing/fixtures.js';
import { csvParser, MAX_CSV_ROWS } from './csvParser.js';
import { txtParser } from './txtParser.js';
import { pdfParser } from './pdfParser.js';
import { createParserRegistry, defaultParserRegistry } from './registry.js';
import { DocumentParseError, UnsupportedFormatError } from './types.js';

const OPTIONS = { maxChars: 60_000 };

function meta(format: DocumentMeta['format'], name: string): DocumentMeta {
  return {
    id: '3f2c8a4e-1b7d-4c9e-8f20-5a6b7c8d9e0f',
    originalName: name,
    sanitizedName: name,
    mimeType: 'text/plain',
    format,
    sizeBytes: 1,
    status: 'uploaded',
    errorMessage: null,
    charCount: 0,
    wasTruncated: false,
    createdAt: '2026-11-21T10:00:00.000Z',
  };
}

describe('txtParser', () => {
  it('decodes UTF-8 and normalises the text', async () => {
    const parsed = await txtParser.parse(Buffer.from('Name:  Jane\r\n\r\n\r\nCity: Pune', 'utf8'), meta('txt', 'a.txt'), OPTIONS);

    expect(parsed.text).toBe('Name: Jane\n\nCity: Pune');
    expect(parsed.charCount).toBe(parsed.text.length);
    expect(parsed.pages).toBeNull();
  });

  it('rejects bytes that are not valid UTF-8', async () => {
    await expect(txtParser.parse(Buffer.from([0xff, 0xfe, 0xfd]), meta('txt', 'bad.txt'), OPTIONS)).rejects.toThrow(
      DocumentParseError,
    );
  });
});

describe('csvParser', () => {
  it('turns rows into "column=value" text and reports columns and row count', async () => {
    const csv = 'name,revenue\nJane Doe,100\nJohn Roe,\n';
    const parsed = await csvParser.parse(Buffer.from(csv), meta('csv', 'f.csv'), OPTIONS);

    expect(parsed.columns).toEqual(['name', 'revenue']);
    expect(parsed.rows).toBe(2);
    expect(parsed.text).toContain('Columns: name, revenue');
    expect(parsed.text).toContain('Row 1: name=Jane Doe; revenue=100');
    expect(parsed.text).toContain('Row 2: name=John Roe; revenue=(empty)');
  });

  it('caps the rows in the text at MAX_CSV_ROWS and warns, but still reports the true row count', async () => {
    const rowCount = MAX_CSV_ROWS + 25;
    const parsed = await csvParser.parse(Buffer.from(makeCsv(['id'], rowCount)), meta('csv', 'big.csv'), {
      maxChars: 1_000_000,
    });

    expect(parsed.rows).toBe(rowCount);
    expect(parsed.text).toContain(`Row ${MAX_CSV_ROWS}: id=id-${MAX_CSV_ROWS}`);
    expect(parsed.text).not.toContain(`Row ${MAX_CSV_ROWS + 1}:`);
    expect(parsed.warnings.some((w) => w.includes(`first ${MAX_CSV_ROWS} of ${rowCount}`))).toBe(true);
  });

  it('rejects a CSV with a header but no data rows', async () => {
    await expect(csvParser.parse(Buffer.from('a,b\n'), meta('csv', 'empty.csv'), OPTIONS)).rejects.toThrow(
      'no data rows',
    );
  });
});

describe('pdfParser', () => {
  it('extracts the text and page count from a valid PDF', async () => {
    const parsed = await pdfParser.parse(makeTextPdf('Applicant: Jane Doe'), meta('pdf', 'app.pdf'), OPTIONS);

    expect(parsed.text).toContain('Applicant: Jane Doe');
    expect(parsed.pages).toBe(1);
  });

  it('turns a corrupted PDF into a DocumentParseError with a readable message', async () => {
    const corrupted = Buffer.from('%PDF-1.4 garbage garbage garbage');

    const err = await pdfParser.parse(corrupted, meta('pdf', 'broken.pdf'), OPTIONS).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(DocumentParseError);
    if (err instanceof DocumentParseError) {
      expect(err.message.length).toBeGreaterThan(10);
      expect(err.message).not.toMatch(/\bat\b.*\.(js|ts):\d+/);
    }
  });
});

describe('parser registry', () => {
  it('returns the parser for each supported format', () => {
    expect(defaultParserRegistry.get('txt')).toBe(txtParser);
    expect(defaultParserRegistry.get('csv')).toBe(csvParser);
    expect(defaultParserRegistry.get('pdf')).toBe(pdfParser);
  });

  it('throws UnsupportedFormatError for a format with no parser (image until OCR exists)', () => {
    expect(() => defaultParserRegistry.get('image')).toThrow(UnsupportedFormatError);
    expect(() => createParserRegistry([]).get('txt')).toThrow(UnsupportedFormatError);
  });
});
