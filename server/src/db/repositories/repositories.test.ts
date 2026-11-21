import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentMeta, Finding } from '@mdw/shared';
import { openDatabase, type Db } from '../client.js';
import { createAnalysesRepo } from './analysesRepo.js';
import { createDocumentsRepo } from './documentsRepo.js';

const NOW = '2026-11-21T10:00:00.000Z';

function makeDocument(name: string, format: DocumentMeta['format']): DocumentMeta {
  return {
    id: randomUUID(),
    originalName: name,
    sanitizedName: name,
    mimeType: format === 'csv' ? 'text/csv' : 'text/plain',
    format,
    sizeBytes: 123,
    status: 'processed',
    errorMessage: null,
    charCount: 42,
    wasTruncated: false,
    createdAt: NOW,
  };
}

describe('documents and analyses repositories (in-memory SQLite)', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('keeps finding provenance (sources -> documentId) through a full round trip', () => {
    const documents = createDocumentsRepo(db);
    const analyses = createAnalysesRepo(db);

    const docA = makeDocument('application.txt', 'txt');
    const docB = makeDocument('financials.csv', 'csv');
    documents.insert(docA, 'Applicant: Jane Doe');
    documents.insert(docB, 'applicant,Jane Do');

    const analysisId = randomUUID();
    analyses.create({
      id: analysisId,
      instruction: 'Check that applicant names match across documents.',
      provider: 'mock',
      documentIds: [docA.id, docB.id],
      createdAt: NOW,
    });

    const factA = {
      id: randomUUID(),
      documentId: docA.id,
      key: 'applicant_name',
      value: 'Jane Doe',
      normalizedValue: 'jane doe',
      category: 'identity' as const,
      sourceSnippet: 'Applicant: Jane Doe',
      confidence: 0.95,
    };
    const factB = {
      id: randomUUID(),
      documentId: docB.id,
      key: 'applicant_name',
      value: 'Jane Do',
      normalizedValue: 'jane do',
      category: 'identity' as const,
      sourceSnippet: 'applicant,Jane Do',
      confidence: 0.9,
    };
    analyses.saveFacts(analysisId, [factA, factB]);

    const discrepancy: Finding = {
      id: randomUUID(),
      analysisId,
      type: 'discrepancy',
      title: 'Applicant name differs',
      description: 'The application says "Jane Doe" but the financials say "Jane Do".',
      severity: 'medium',
      sources: [
        { documentId: docA.id, factId: factA.id, snippet: 'Applicant: Jane Doe' },
        { documentId: docB.id, factId: factB.id, snippet: 'applicant,Jane Do' },
      ],
      isInterpretation: true,
    };
    analyses.saveFindings(analysisId, [discrepancy]);
    analyses.updateStatus(analysisId, 'completed', {
      summary: 'One discrepancy found.',
      completedAt: NOW,
    });

    const result = analyses.getFullAnalysis(analysisId);

    expect(result).not.toBeNull();
    expect(result?.status).toBe('completed');
    expect(result?.documentIds).toEqual([docA.id, docB.id]);

    // Facts stay grouped per document.
    expect(result?.perDocumentFacts[docA.id]?.map((f) => f.value)).toEqual(['Jane Doe']);
    expect(result?.perDocumentFacts[docB.id]?.map((f) => f.value)).toEqual(['Jane Do']);

    // Interpretation keeps its provenance.
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.sources.map((s) => s.documentId)).toEqual([docA.id, docB.id]);
    expect(result?.findings[0]?.sources[1]?.factId).toBe(factB.id);
    expect(result?.findings[0]?.isInterpretation).toBe(true);
    expect(result?.missingInformation).toEqual([]);
  });

  it('rejects a finding without sources and writes nothing for that batch', () => {
    const documents = createDocumentsRepo(db);
    const analyses = createAnalysesRepo(db);

    const doc = makeDocument('notes.txt', 'txt');
    documents.insert(doc, 'some text');
    const analysisId = randomUUID();
    analyses.create({
      id: analysisId,
      instruction: 'Summarise the document.',
      provider: 'mock',
      documentIds: [doc.id],
      createdAt: NOW,
    });

    const valid: Finding = {
      id: randomUUID(),
      analysisId,
      type: 'summary_point',
      title: 'Valid point',
      description: 'Has provenance.',
      severity: null,
      sources: [{ documentId: doc.id, factId: null, snippet: null }],
      isInterpretation: true,
    };
    const invalid: Finding = {
      id: randomUUID(),
      analysisId,
      type: 'summary_point',
      title: 'No provenance',
      description: 'Must be rejected.',
      severity: null,
      sources: [],
      isInterpretation: true,
    };

    expect(() => analyses.saveFindings(analysisId, [valid, invalid])).toThrow();
    expect(analyses.getFullAnalysis(analysisId)?.findings).toEqual([]);
  });

  it('returns null for an unknown analysis and lists documents newest first', () => {
    const documents = createDocumentsRepo(db);
    const analyses = createAnalysesRepo(db);

    expect(analyses.getFullAnalysis(randomUUID())).toBeNull();

    const older = { ...makeDocument('old.txt', 'txt'), createdAt: '2026-11-20T10:00:00.000Z' };
    const newer = { ...makeDocument('new.txt', 'txt'), createdAt: '2026-11-21T10:00:00.000Z' };
    documents.insert(older, null);
    documents.insert(newer, null);

    expect(documents.list().map((d) => d.originalName)).toEqual(['new.txt', 'old.txt']);
  });
});
