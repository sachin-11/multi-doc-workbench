import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Finding } from '@mdw/shared';
import { createTestApp } from '../testing/testApp.js';
import { validateUpload } from '../upload/validation.js';
import { randomUUID } from 'node:crypto';

/*
 * End-to-end check on the committed synthetic sample set (samples/). Goes through the real upload
 * validation, parser pipeline and analysis engine with the MOCK provider, and asserts the planted findings
 * listed in samples/EXPECTED_FINDINGS.md.
 */

const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../samples');
const NOW = '2026-11-21T10:00:00.000Z';
const INSTRUCTION = 'Highlight discrepancies in names, addresses, licence details, or revenue figures';

const VALID_SAMPLES = [
  { name: 'application_form.pdf', mimeType: 'application/pdf' },
  { name: 'supporting_letter.txt', mimeType: 'text/plain' },
  { name: 'financials_fy2025.csv', mimeType: 'text/csv' },
  { name: 'kyc_summary.txt', mimeType: 'text/plain' },
];

function readSample(relative: string): Buffer {
  return fs.readFileSync(path.join(SAMPLES_DIR, relative));
}

function find(findings: Finding[], type: Finding['type'], titlePrefix: string): Finding | undefined {
  return findings.find((f) => f.type === type && f.title.startsWith(titlePrefix));
}

describe('synthetic sample set (samples/)', () => {
  it('loads all four valid samples through the real pipeline', async () => {
    const ctx = createTestApp();
    const ids: string[] = [];

    for (const sample of VALID_SAMPLES) {
      const buffer = readSample(sample.name);
      const id = randomUUID();
      const result = validateUpload(
        { originalName: sample.name, declaredMimeType: sample.mimeType, buffer },
        { id, createdAt: NOW },
      );
      expect(result.ok, `${sample.name} should be accepted`).toBe(true);
      ctx.documents.insert(result.meta, null);
      ctx.buffers.put(id, buffer);
      await ctx.processor.processNow(id);
      ids.push(id);
    }

    for (const id of ids) {
      expect(ctx.documents.getById(id)?.status).toBe('processed');
    }
    const pdf = ctx.processor.getParsedDocument(ids[0] ?? '');
    expect(pdf?.text).toContain('FSL-TEST-0042');
    ctx.close();
  });

  it.each([
    ['fake.pdf', 'application/pdf'],
    ['empty.txt', 'text/plain'],
    ['script.exe', 'application/x-msdownload'],
    ['notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('rejects invalid_samples/%s with a reason', (name, mimeType) => {
    const result = validateUpload(
      { originalName: name, declaredMimeType: mimeType, buffer: readSample(path.join('invalid_samples', name)) },
      { id: randomUUID(), createdAt: NOW },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('produces the planted discrepancies and missing items with the MOCK provider', async () => {
    const ctx = createTestApp();
    const ids: string[] = [];
    for (const sample of VALID_SAMPLES) {
      const buffer = readSample(sample.name);
      const id = randomUUID();
      const result = validateUpload(
        { originalName: sample.name, declaredMimeType: sample.mimeType, buffer },
        { id, createdAt: NOW },
      );
      if (!result.ok) throw new Error(`fixture rejected: ${sample.name}`);
      ctx.documents.insert(result.meta, null);
      ctx.buffers.put(id, buffer);
      await ctx.processor.processNow(id);
      ids.push(id);
    }

    const result = await ctx.analysisService.run({ documentIds: ids, instruction: INSTRUCTION });
    expect(result.status).toBe('completed');

    // Planted discrepancies (names, addresses, licence details, revenue).
    expect(find(result.findings, 'discrepancy', 'applicant')).toBeDefined(); // Rohan Mehta vs Rohan Mehra
    expect(find(result.findings, 'discrepancy', 'address')).toBeDefined(); // Sector 21 vs Sector 12
    expect(find(result.findings, 'discrepancy', 'licence_expiry')).toBeDefined(); // 2027 vs 2026
    const revenue = find(result.findings, 'discrepancy', 'revenue_fy2025');
    expect(revenue).toBeDefined(); // three different figures
    expect(new Set(revenue?.sources.map((s) => s.documentId)).size).toBe(3);

    // The company name variant ("Pvt Ltd" vs "Private Limited") is consistent, not a discrepancy.
    expect(find(result.findings, 'discrepancy', 'company')).toBeUndefined();

    // Missing information: co-director and revenue are absent from the KYC summary.
    const missing = result.missingInformation.map((f) => f.title);
    expect(missing).toContain('co_director is missing from supporting_letter.txt, financials_fy2025.csv, kyc_summary.txt');
    expect(missing.some((t) => t.startsWith('revenue_fy2025 is missing') && t.includes('kyc_summary.txt'))).toBe(true);

    // Provenance: every finding cites at least one document.
    for (const finding of [...result.findings, ...result.missingInformation]) {
      expect(finding.sources.length).toBeGreaterThan(0);
    }
    ctx.close();
  });
});
