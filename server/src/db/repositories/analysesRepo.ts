import { z } from 'zod';
import {
  AnalysisResultSchema,
  AnalysisSummarySchema,
  ComparisonTableSchema,
  ExtractedFactSchema,
  FindingSchema,
  type AnalysisProvider,
  type AnalysisResult,
  type AnalysisStatus,
  type AnalysisSummary,
  type ComparisonTable,
  type ExtractedFact,
  type Finding,
  type FindingSource,
  type FindingType,
  type Severity,
} from '@mdw/shared';
import type { Db } from '../client.js';

export interface CreateAnalysisInput {
  id: string;
  instruction: string;
  provider: AnalysisProvider;
  documentIds: string[];
  createdAt: string;
}

/** Everything a finished run writes. Written in one transaction by `persistRun`. */
export type RunOutcome =
  | {
      status: 'completed';
      facts: ExtractedFact[];
      findings: Finding[];
      summary: string | null;
      comparisonTable: ComparisonTable | null;
      warnings: string[];
      completedAt: string;
    }
  | {
      status: 'failed';
      /** Facts extracted before the failure are kept. */
      facts: ExtractedFact[];
      warnings: string[];
      errorMessage: string;
      completedAt: string;
    };

/** Fields written when an analysis changes status. Omitted fields keep their stored value. */
export interface StatusUpdate {
  summary?: string | null;
  comparisonTable?: ComparisonTable | null;
  errorMessage?: string | null;
  completedAt?: string | null;
}

interface AnalysisRow {
  id: string;
  instruction: string;
  status: string;
  provider: string;
  summary: string | null;
  comparison_table_json: string | null;
  warnings_json: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface FactRow {
  id: string;
  analysis_id: string;
  document_id: string;
  key: string;
  value: string;
  normalized_value: string | null;
  category: string;
  source_snippet: string;
  confidence: number;
}

interface FindingRow {
  id: string;
  analysis_id: string;
  type: string;
  title: string;
  description: string;
  severity: string | null;
}

interface FindingSourceRow {
  finding_id: string;
  document_id: string;
  fact_id: string | null;
  snippet: string | null;
}

function parseComparisonTable(json: string | null): ComparisonTable | null {
  if (json === null) return null;
  const parsed: unknown = JSON.parse(json);
  return ComparisonTableSchema.parse(parsed);
}

export function createAnalysesRepo(db: Db) {
  const insertAnalysisStmt = db.prepare(`
    INSERT INTO analyses (id, instruction, status, provider, created_at)
    VALUES (@id, @instruction, 'pending', @provider, @createdAt)`);
  const insertDocumentLinkStmt = db.prepare(
    `INSERT INTO analysis_documents (analysis_id, document_id) VALUES (?, ?)`,
  );
  const updateStatusStmt = db.prepare(`
    UPDATE analyses SET
      status                = @status,
      summary               = COALESCE(@summary, summary),
      comparison_table_json = COALESCE(@comparisonTableJson, comparison_table_json),
      error_message         = COALESCE(@errorMessage, error_message),
      completed_at          = COALESCE(@completedAt, completed_at)
    WHERE id = @id`);

  const insertFactStmt = db.prepare(`
    INSERT INTO extracted_facts (
      id, analysis_id, document_id, key, value, normalized_value, category, source_snippet, confidence
    ) VALUES (
      @id, @analysisId, @documentId, @key, @value, @normalizedValue, @category, @sourceSnippet, @confidence
    )`);

  const insertFindingStmt = db.prepare(`
    INSERT INTO findings (id, analysis_id, type, title, description, severity, created_at)
    VALUES (@id, @analysisId, @type, @title, @description, @severity, @createdAt)`);
  const insertSourceStmt = db.prepare(`
    INSERT INTO finding_sources (finding_id, document_id, fact_id, snippet)
    VALUES (@findingId, @documentId, @factId, @snippet)`);

  const getAnalysisStmt = db.prepare<[string], AnalysisRow>(`SELECT * FROM analyses WHERE id = ?`);
  const getDocumentIdsStmt = db.prepare<[string], { document_id: string }>(
    `SELECT document_id FROM analysis_documents WHERE analysis_id = ? ORDER BY rowid`,
  );
  const getFactsStmt = db.prepare<[string], FactRow>(
    `SELECT * FROM extracted_facts WHERE analysis_id = ? ORDER BY rowid`,
  );
  const getFindingsStmt = db.prepare<[string], FindingRow>(
    `SELECT * FROM findings WHERE analysis_id = ? ORDER BY rowid`,
  );
  const getSourcesStmt = db.prepare<[string], FindingSourceRow>(`
    SELECT fs.* FROM finding_sources fs
    JOIN findings f ON f.id = fs.finding_id
    WHERE f.analysis_id = ?
    ORDER BY fs.id`);

  const finalizeStmt = db.prepare(`
    UPDATE analyses SET
      status                = @status,
      summary               = @summary,
      comparison_table_json = @comparisonTableJson,
      warnings_json         = @warningsJson,
      error_message         = @errorMessage,
      completed_at          = @completedAt
    WHERE id = @id`);
  const listAnalysesStmt = db.prepare<[number], AnalysisRow>(
    `SELECT * FROM analyses ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  );
  const listDocumentIdsStmt = db.prepare<[string], { document_id: string }>(
    `SELECT document_id FROM analysis_documents WHERE analysis_id = ? ORDER BY rowid`,
  );

  const createTx = db.transaction((input: CreateAnalysisInput) => {
    insertAnalysisStmt.run({
      id: input.id,
      instruction: input.instruction,
      provider: input.provider,
      createdAt: input.createdAt,
    });
    for (const documentId of input.documentIds) {
      insertDocumentLinkStmt.run(input.id, documentId);
    }
  });

  const saveFactsTx = db.transaction((analysisId: string, facts: ExtractedFact[]) => {
    for (const raw of facts) {
      const fact = ExtractedFactSchema.parse(raw);
      insertFactStmt.run({
        id: fact.id,
        analysisId,
        documentId: fact.documentId,
        key: fact.key,
        value: fact.value,
        normalizedValue: fact.normalizedValue,
        category: fact.category,
        sourceSnippet: fact.sourceSnippet,
        confidence: fact.confidence,
      });
    }
  });

  const saveFindingsTx = db.transaction((analysisId: string, findings: Finding[]) => {
    for (const raw of findings) {
      // Parsing rejects findings without sources. The throw rolls back the whole transaction.
      const finding = FindingSchema.parse(raw);
      insertFindingStmt.run({
        id: finding.id,
        analysisId,
        type: finding.type,
        title: finding.title,
        description: finding.description,
        severity: finding.severity,
        createdAt: new Date().toISOString(),
      });
      for (const source of finding.sources) {
        insertSourceStmt.run({
          findingId: finding.id,
          documentId: source.documentId,
          factId: source.factId,
          snippet: source.snippet,
        });
      }
    }
  });

  // Nested calls to saveFactsTx / saveFindingsTx become savepoints, so the whole run is one transaction.
  const persistRunTx = db.transaction((analysisId: string, outcome: RunOutcome) => {
    saveFactsTx(analysisId, outcome.facts);
    const isCompleted = outcome.status === 'completed';
    if (outcome.status === 'completed') {
      saveFindingsTx(analysisId, outcome.findings);
    }
    finalizeStmt.run({
      id: analysisId,
      status: outcome.status,
      summary: isCompleted ? outcome.summary : null,
      comparisonTableJson:
        isCompleted && outcome.comparisonTable
          ? JSON.stringify(ComparisonTableSchema.parse(outcome.comparisonTable))
          : null,
      warningsJson: JSON.stringify(outcome.warnings),
      errorMessage: isCompleted ? null : outcome.errorMessage,
      completedAt: outcome.completedAt,
    });
  });

  return {
    /**
     * Writes a finished run atomically: facts, findings with provenance, summary, table, warnings and
     * final status. A throw rolls back everything, so the analysis never ends half-written.
     */
    persistRun(analysisId: string, outcome: RunOutcome): void {
      persistRunTx(analysisId, outcome);
    },

    /** Most recent analyses first, without their facts or findings. */
    list(limit: number): AnalysisSummary[] {
      return listAnalysesStmt.all(limit).map((row) =>
        AnalysisSummarySchema.parse({
          id: row.id,
          instruction: row.instruction,
          status: row.status,
          documentIds: listDocumentIdsStmt.all(row.id).map((r) => r.document_id),
          createdAt: row.created_at,
        }),
      );
    },

    /** Creates an analysis in `pending` state and links its documents, atomically. */
    create(input: CreateAnalysisInput): void {
      createTx(input);
    },

    updateStatus(id: string, status: AnalysisStatus, update: StatusUpdate = {}): void {
      updateStatusStmt.run({
        id,
        status,
        summary: update.summary ?? null,
        comparisonTableJson:
          update.comparisonTable === undefined || update.comparisonTable === null
            ? null
            : JSON.stringify(ComparisonTableSchema.parse(update.comparisonTable)),
        errorMessage: update.errorMessage ?? null,
        completedAt: update.completedAt ?? null,
      });
    },

    /** Stores per-document facts (stage 1 output). Each fact is validated before insert. */
    saveFacts(analysisId: string, facts: ExtractedFact[]): void {
      saveFactsTx(analysisId, facts);
    },

    /** Stores cross-document findings (stage 2 output) with their provenance rows. */
    saveFindings(analysisId: string, findings: Finding[]): void {
      saveFindingsTx(analysisId, findings);
    },

    /** Rebuilds the full AnalysisResult from the normalised tables. Returns null if not found. */
    getFullAnalysis(id: string): AnalysisResult | null {
      const analysis = getAnalysisStmt.get(id) as AnalysisRow | undefined;
      if (!analysis) return null;

      const documentIds = getDocumentIdsStmt.all(id).map((r) => r.document_id);

      const perDocumentFacts: Record<string, ExtractedFact[]> = {};
      for (const documentId of documentIds) perDocumentFacts[documentId] = [];
      for (const row of getFactsStmt.all(id)) {
        const fact = ExtractedFactSchema.parse({
          id: row.id,
          documentId: row.document_id,
          key: row.key,
          value: row.value,
          normalizedValue: row.normalized_value,
          category: row.category,
          sourceSnippet: row.source_snippet,
          confidence: row.confidence,
        });
        (perDocumentFacts[fact.documentId] ??= []).push(fact);
      }

      const sourcesByFinding = new Map<string, FindingSource[]>();
      for (const row of getSourcesStmt.all(id)) {
        const list = sourcesByFinding.get(row.finding_id) ?? [];
        list.push({ documentId: row.document_id, factId: row.fact_id, snippet: row.snippet });
        sourcesByFinding.set(row.finding_id, list);
      }

      const allFindings: Finding[] = getFindingsStmt.all(id).map((row) =>
        FindingSchema.parse({
          id: row.id,
          analysisId: row.analysis_id,
          type: row.type as FindingType,
          title: row.title,
          description: row.description,
          severity: row.severity as Severity | null,
          sources: sourcesByFinding.get(row.id) ?? [],
          isInterpretation: true,
        }),
      );

      return AnalysisResultSchema.parse({
        id: analysis.id,
        instruction: analysis.instruction,
        status: analysis.status,
        documentIds,
        perDocumentFacts,
        findings: allFindings.filter((f) => f.type !== 'missing_information'),
        comparisonTable: parseComparisonTable(analysis.comparison_table_json),
        summary: analysis.summary,
        missingInformation: allFindings.filter((f) => f.type === 'missing_information'),
        provider: analysis.provider,
        warnings: z.array(z.string()).parse(JSON.parse(analysis.warnings_json)),
        errorMessage: analysis.error_message,
        createdAt: analysis.created_at,
        completedAt: analysis.completed_at,
      });
    },
  };
}

export type AnalysesRepo = ReturnType<typeof createAnalysesRepo>;
