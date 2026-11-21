import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ExtractedFactSchema, FindingSchema } from '../src/index.js';

/*
 * Provenance at the contract level. These schemas are shared by the server and the client, so a rule
 * enforced here cannot be bypassed by one side. The server also enforces it at the database layer.
 */

function validFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    analysisId: randomUUID(),
    type: 'discrepancy',
    title: 'revenue_fy2025 differs between documents',
    description: 'Values differ: 4,80,00,000 and 3,95,00,000.',
    severity: 'high',
    sources: [{ documentId: randomUUID(), factId: null, snippet: null }],
    isInterpretation: true,
    ...overrides,
  };
}

describe('FindingSchema provenance rules', () => {
  it('accepts a finding with at least one source document', () => {
    expect(FindingSchema.safeParse(validFinding()).success).toBe(true);
  });

  it('rejects a finding with an empty sources array', () => {
    expect(FindingSchema.safeParse(validFinding({ sources: [] })).success).toBe(false);
  });

  it('rejects a finding with no sources field at all', () => {
    const { sources: _omitted, ...withoutSources } = validFinding();
    expect(FindingSchema.safeParse(withoutSources).success).toBe(false);
  });

  it('rejects a source that is not a document id', () => {
    expect(FindingSchema.safeParse(validFinding({ sources: [{ documentId: 'doc-1', factId: null, snippet: null }] })).success).toBe(false);
  });

  it('rejects a finding that is not marked as AI interpretation', () => {
    expect(FindingSchema.safeParse(validFinding({ isInterpretation: false })).success).toBe(false);
  });
});

describe('ExtractedFactSchema provenance rules', () => {
  const fact = {
    id: randomUUID(),
    documentId: randomUUID(),
    key: 'applicant_name',
    value: 'Rohan Mehta',
    normalizedValue: 'rohan mehta',
    category: 'identity',
    sourceSnippet: 'Applicant: Rohan Mehta',
    confidence: 0.9,
  };

  it('accepts a fact that names its document', () => {
    expect(ExtractedFactSchema.safeParse(fact).success).toBe(true);
  });

  it('rejects a fact with no documentId', () => {
    const { documentId: _omitted, ...withoutDocument } = fact;
    expect(ExtractedFactSchema.safeParse(withoutDocument).success).toBe(false);
  });

  it('rejects a fact with no quoted source snippet', () => {
    expect(ExtractedFactSchema.safeParse({ ...fact, sourceSnippet: '' }).success).toBe(false);
  });
});
