import { describe, it, expect } from 'vitest';
import { validateUpload, sanitizeFilename, type IncomingFile } from './validation.js';

const IDS = { id: '3f2c8a4e-1b7d-4c9e-8f20-5a6b7c8d9e0f', createdAt: '2026-11-21T10:00:00.000Z' };

function file(originalName: string, content: string | Buffer, declaredMimeType: string): IncomingFile {
  return {
    originalName,
    declaredMimeType,
    buffer: typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
  };
}

describe('validateUpload', () => {
  it('accepts a valid PDF (magic bytes match)', () => {
    const result = validateUpload(
      file('application.pdf', '%PDF-1.4\n%synthetic test content', 'application/pdf'),
      IDS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.format).toBe('pdf');
    expect(result.meta.status).toBe('uploaded');
    expect(result.meta.sanitizedName).toBe('application.pdf');
    expect(result.meta.errorMessage).toBeNull();
  });

  it('rejects a fake PDF whose content does not start with %PDF-', () => {
    const result = validateUpload(file('fake.pdf', 'this is plain text', 'application/pdf'), IDS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SIGNATURE_MISMATCH');
    expect(result.meta.status).toBe('failed');
    expect(result.meta.errorMessage).toBe(result.reason);
  });

  it('rejects an empty file', () => {
    const result = validateUpload(file('empty.txt', '', 'text/plain'), IDS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EMPTY_FILE');
    expect(result.meta.sizeBytes).toBe(0);
  });

  it('rejects a disallowed extension (.exe) as unsupported', () => {
    const result = validateUpload(
      file('setup.exe', 'MZ\u0000\u0000 binary', 'application/x-msdownload'),
      IDS,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNSUPPORTED_EXTENSION');
    expect(result.meta.status).toBe('unsupported');
    expect(result.meta.format).toBeNull();
  });

  it('rejects a declared MIME type that does not match the extension', () => {
    const result = validateUpload(file('report.pdf', '%PDF-1.4', 'text/plain'), IDS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MIME_MISMATCH');
  });

  it('rejects a TXT file that contains NUL bytes or invalid UTF-8', () => {
    const withNul = validateUpload(file('bin.txt', Buffer.from([0x68, 0x00, 0x69]), 'text/plain'), IDS);
    const badUtf8 = validateUpload(file('bad.txt', Buffer.from([0xff, 0xfe, 0xfd]), 'text/plain'), IDS);

    expect(withNul.ok).toBe(false);
    expect(badUtf8.ok).toBe(false);
    if (!withNul.ok) expect(withNul.code).toBe('INVALID_TEXT');
    if (!badUtf8.ok) expect(badUtf8.code).toBe('INVALID_TEXT');
  });

  it('accepts CSV sent with the Windows-style application/vnd.ms-excel type', () => {
    const result = validateUpload(file('financials.csv', 'a,b\n1,2\n', 'application/vnd.ms-excel'), IDS);

    expect(result.ok).toBe(true);
  });

  it('sanitizes a path-traversal filename and keeps the original for display', () => {
    const result = validateUpload(file('../../etc/passwd.txt', 'hello', 'text/plain'), IDS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.sanitizedName).toBe('passwd.txt');
    expect(result.meta.originalName).toBe('passwd.txt');
  });
});

describe('sanitizeFilename', () => {
  it('strips Windows path segments', () => {
    expect(sanitizeFilename('C:\\Users\\evil\\..\\..\\boot.ini.txt')).toBe('boot.ini.txt');
  });

  it('removes control characters and unsafe symbols', () => {
    expect(sanitizeFilename('my\u0000file\u0007 <final>?.TXT')).toBe('myfile_final.txt');
  });

  it('never produces a hidden file or an empty name', () => {
    expect(sanitizeFilename('.bashrc')).toBe('bashrc');
    expect(sanitizeFilename('...')).toBe('document');
    expect(sanitizeFilename('')).toBe('document');
  });

  it('limits the stem length', () => {
    const long = `${'a'.repeat(300)}.csv`;
    const safe = sanitizeFilename(long);

    expect(safe.endsWith('.csv')).toBe(true);
    expect(safe.length).toBeLessThanOrEqual(110);
  });
});
