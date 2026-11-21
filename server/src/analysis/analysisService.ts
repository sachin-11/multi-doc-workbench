import { randomUUID } from 'node:crypto';
import {
  CrossDocumentAnalysisOutputSchema,
  PerDocumentExtractionOutputSchema,
  type AnalysisRequest,
  type AnalysisResult,
  type ComparisonTable,
  type CrossDocumentAnalysisOutput,
  type DocumentFormat,
  type ExtractedFact,
  type Finding,
  type ParsedDocument,
} from '@mdw/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { AnalysesRepo, RunOutcome } from '../db/repositories/analysesRepo.js';
import type { DocumentsRepo } from '../db/repositories/documentsRepo.js';
import type { DocumentProcessor } from '../processing/index.js';
import type { LLMProvider } from '../llm/types.js';
import { LLMOutputValidationError, LLMRequestError } from '../llm/types.js';
import {
  buildCrossDocumentAnalysisPrompt,
  buildPerDocumentExtractionPrompt,
  mergeChunkFacts,
  SCHEMA_NAMES,
  type ExtractionFact,
} from '../llm/prompts.js';
import {
  attachSnippetsFromFacts,
  enforceFactOwnership,
  validateProvenance,
  verifyFacts,
} from '../llm/guards.js';
import { compareFacts, type DeterministicComparison, type VerifiedComparison } from './comparison.js';
import { groundModelFindings } from './grounding.js';
import { replaceDocumentIds } from './summary.js';

/*
 * Analysis engine (M6, reworked so the comparison is deterministic). Order of operations:
 *   1. Resolve documents. Problem documents are skipped with a warning. At least one must be usable.
 *   2. Stage A (independent): per-document, per-chunk extraction. Documents run in parallel, each with its
 *      own prompts. A failing document is excluded with a warning and the run continues.
 *   3. Deterministic comparison (code, no model): comparison table, discrepancies and missing information are
 *      computed from the facts by normalised key and value (comparison.ts). Every value comes from a fact.
 *   4. Stage B (collective): the cross-document prompt receives ONLY the structured facts, grouped by
 *      documentId, plus the verified comparison. The model writes the summary and may add extra findings.
 *   5. Guards on the model output: provenance (known documents and facts), fact ownership, snippet backfill,
 *      and value grounding (grounding.ts), which rebuilds discrepancy and comparison wording from the facts.
 *   6. Persist once: facts, findings, summary, table, warnings and final status, in one transaction.
 *
 * Failure policy: a per-document or per-chunk failure is a warning. A fatal failure (no document could be
 * extracted, the cross-document call fails, or the total time budget runs out) marks the run `failed`.
 * Facts from stage A are still saved in that case.
 */

const EXTRACTION_CONCURRENCY = 3;
const SINGLE_DOCUMENT_WARNING =
  'Single-document mode: fewer than two documents were analysed, so comparisons and discrepancies were not produced. Only facts and a summary are returned.';

export interface AnalysisServiceOptions {
  /** ANALYSIS_TIMEOUT_MS: total budget for one run. */
  timeoutMs: number;
}

export interface AnalysisServiceDeps {
  documents: Pick<DocumentsRepo, 'getById'>;
  analyses: AnalysesRepo;
  processor: Pick<DocumentProcessor, 'getParsedDocument'>;
  provider: LLMProvider;
  options: AnalysisServiceOptions;
}

export interface AnalysisService {
  run(request: AnalysisRequest): Promise<AnalysisResult>;
}

/** A document that can take part in the analysis, with its stored text and chunks. */
interface UsableDocument {
  documentId: string;
  originalName: string;
  format: DocumentFormat;
  parsed: ParsedDocument;
}

interface DocumentProblem {
  documentId: string;
  originalName: string | null;
  reason: string;
}

/** Errors whose messages are safe to store and show. Anything else gets a generic message. */
class AnalysisFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisFailure';
  }
}

class AnalysisTimeoutError extends AnalysisFailure {
  constructor() {
    super('The analysis took too long and was stopped. Facts extracted before the stop were kept.');
    this.name = 'AnalysisTimeoutError';
  }
}

/** Thrown inside the work after the deadline, so it does not start new provider calls. */
class AnalysisCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AnalysisCancelledError';
  }
}

interface RunState {
  cancelled: boolean;
  /** Facts from documents that finished stage A. Saved even if a later stage fails. */
  facts: ExtractedFact[];
  warnings: string[];
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof AnalysisFailure) return err.message;
  if (err instanceof LLMRequestError) return err.message;
  if (err instanceof LLMOutputValidationError) return err.message;
  return 'The analysis failed unexpectedly. Check the server logs for details.';
}

function assertNotCancelled(state: RunState): void {
  if (state.cancelled) throw new AnalysisCancelledError();
}

/** Runs fn over items with at most `limit` in flight. fn must not throw. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function timed<T>(analysisId: string, stage: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  return work().finally(() => {
    logger.info('analysis stage finished', { analysisId, stage, ms: Date.now() - started });
  });
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  const { documents, analyses, processor, provider, options } = deps;

  /** Splits the request into usable documents and problems. Unknown or unready documents are skipped. */
  function resolveDocuments(documentIds: readonly string[]): {
    usable: UsableDocument[];
    problems: DocumentProblem[];
  } {
    const usable: UsableDocument[] = [];
    const problems: DocumentProblem[] = [];

    for (const documentId of documentIds) {
      const record = documents.getById(documentId);
      if (!record) {
        problems.push({ documentId, originalName: null, reason: 'not found' });
        continue;
      }
      if (record.status !== 'processed') {
        problems.push({ documentId, originalName: record.originalName, reason: record.status });
        continue;
      }
      const parsed = processor.getParsedDocument(documentId);
      if (!parsed || record.format === null) {
        problems.push({ documentId, originalName: record.originalName, reason: 'text unavailable' });
        continue;
      }
      usable.push({ documentId, originalName: record.originalName, format: parsed.format, parsed });
    }
    return { usable, problems };
  }

  /** Stage A for one document: each chunk is a separate call. Returns null when no chunk produced facts. */
  async function extractDocument(
    doc: UsableDocument,
    instruction: string,
    state: RunState,
  ): Promise<ExtractedFact[] | null> {
    const prompts = buildPerDocumentExtractionPrompt(
      {
        documentId: doc.documentId,
        originalName: doc.originalName,
        format: doc.format,
        chunks: doc.parsed.chunks,
      },
      instruction,
    );
    if (prompts.length === 0) {
      state.warnings.push(`${doc.originalName}: the document has no text, so no facts were extracted.`);
      return [];
    }

    const perChunk: ExtractionFact[][] = [];
    let failedChunks = 0;
    for (const [index, prompt] of prompts.entries()) {
      assertNotCancelled(state);
      try {
        const result = await provider.generateStructured({
          system: prompt.system,
          user: prompt.user,
          schema: PerDocumentExtractionOutputSchema,
          schemaName: SCHEMA_NAMES.extraction,
          temperature: 0,
        });
        perChunk.push(result.data.facts);
      } catch (err) {
        if (err instanceof AnalysisCancelledError) throw err;
        failedChunks += 1;
        state.warnings.push(
          `${doc.originalName}: part ${index + 1} of ${prompts.length} could not be analysed (${safeErrorMessage(err)}).`,
        );
      }
    }

    if (perChunk.length === 0) return null;
    if (failedChunks > 0) {
      state.warnings.push(`${doc.originalName}: ${failedChunks} of ${prompts.length} part(s) were skipped.`);
    }

    // Facts get their ids here, not from the model. Snippets are checked against the full stored text.
    const merged = mergeChunkFacts(perChunk).map((fact) => ({
      ...fact,
      id: randomUUID(),
      documentId: doc.documentId,
    }));
    const textByDocumentId = { [doc.documentId]: doc.parsed.text };
    const verified = verifyFacts(merged, textByDocumentId);
    state.warnings.push(...verified.warnings);
    return verified.cleaned;
  }

  /** Stage B: cross-document interpretation. Input is the facts only. */
  async function interpret(
    analysisId: string,
    instruction: string,
    facts: Map<string, ExtractedFact[]>,
    docs: readonly UsableDocument[],
    verified: VerifiedComparison | undefined,
    state: RunState,
  ): Promise<CrossDocumentAnalysisOutput> {
    assertNotCancelled(state);
    const prompt = buildCrossDocumentAnalysisPrompt({
      instruction,
      documents: docs.map((doc) => ({
        documentId: doc.documentId,
        originalName: doc.originalName,
        facts: facts.get(doc.documentId) ?? [],
      })),
      ...(verified ? { verifiedComparison: verified } : {}),
    });
    const raw = await timed(analysisId, 'cross_document', async () =>
      provider.generateStructured({
        system: prompt.system,
        user: prompt.user,
        schema: CrossDocumentAnalysisOutputSchema,
        schemaName: SCHEMA_NAMES.crossDocument,
        temperature: 0,
      }),
    );
    return raw.data;
  }

  /** Runs both stages and the guards. Persistence happens in the caller, once. */
  async function executeStages(
    analysisId: string,
    instruction: string,
    usable: UsableDocument[],
    state: RunState,
  ): Promise<{ findings: Finding[]; missingInformation: Finding[]; summary: string | null; comparisonTable: ComparisonTable | null }> {
    // Stage A: documents in parallel, chunks in order within a document.
    const extracted = await timed(analysisId, 'extraction', () =>
      mapWithConcurrency(usable, EXTRACTION_CONCURRENCY, async (doc) => {
        try {
          const facts = await extractDocument(doc, instruction, state);
          if (facts === null) {
            state.warnings.push(
              `${doc.originalName} could not be analysed and was excluded from the cross-document comparison.`,
            );
          }
          return { doc, facts };
        } catch (err) {
          if (err instanceof AnalysisCancelledError) throw err;
          state.warnings.push(
            `${doc.originalName} could not be analysed and was excluded (${safeErrorMessage(err)}).`,
          );
          return { doc, facts: null };
        }
      }),
    );

    const factsByDocument = new Map<string, ExtractedFact[]>();
    for (const { doc, facts } of extracted) {
      if (facts === null) continue;
      factsByDocument.set(doc.documentId, facts);
      state.facts.push(...facts);
    }

    const succeeded = usable.filter((doc) => factsByDocument.has(doc.documentId));
    if (succeeded.length === 0) {
      throw new AnalysisFailure('No selected document could be analysed. See the warnings for each document.');
    }

    // Stage B needs at least two documents. With one, we keep the summary only.
    const singleDocumentMode = succeeded.length < 2;
    if (singleDocumentMode) state.warnings.push(SINGLE_DOCUMENT_WARNING);

    // The comparison is computed from the facts in code. With one document there is nothing to compare.
    const deterministic: DeterministicComparison | null = singleDocumentMode
      ? null
      : compareFacts(
          succeeded.map((doc) => ({ documentId: doc.documentId, originalName: doc.originalName })),
          factsByDocument,
        );

    const output = await interpret(
      analysisId,
      instruction,
      factsByDocument,
      succeeded,
      deterministic?.verified,
      state,
    );

    // The model's missing-information items and table are not used: code owns them. Only its summary and
    // extra findings continue, and those go through the guards below.
    const modelOutput: CrossDocumentAnalysisOutput = {
      ...output,
      findings: output.findings.filter((f) => f.type !== 'missing_information'),
      missingInformation: [],
      comparisonTable: null,
    };

    // Guards run on every output, whatever produced it.
    const allFacts = [...factsByDocument.values()].flat();
    const factOwner = new Map(allFacts.map((fact) => [fact.id, fact.documentId]));
    const factById = new Map(allFacts.map((fact) => [fact.id, fact]));

    const provenance = validateProvenance(
      modelOutput,
      succeeded.map((doc) => doc.documentId),
      [...factOwner.keys()],
    );
    const ownership = enforceFactOwnership(provenance.cleaned, factOwner);
    state.warnings.push(...provenance.warnings, ...ownership.warnings);
    const guarded = attachSnippetsFromFacts(ownership.cleaned, factById);

    if (deterministic === null) {
      return { findings: [], missingInformation: [], summary: guarded.summary, comparisonTable: null };
    }

    // Value grounding: a model discrepancy or comparison is kept only if its cited facts back it, and its
    // wording is rebuilt from those facts.
    const grounded = groundModelFindings(guarded.findings, {
      factById,
      documentNames: new Map(succeeded.map((doc) => [doc.documentId, doc.originalName])),
      factKeys: deterministic.factKeys,
      coveredKeys: deterministic.coveredKeys,
    });
    state.warnings.push(...grounded.warnings);

    const named = succeeded.map((doc) => ({ documentId: doc.documentId, originalName: doc.originalName }));
    const summary =
      guarded.summary !== null && guarded.summary.trim().length > 0
        ? replaceDocumentIds(guarded.summary, named)
        : deterministic.fallbackSummary;
    const modelFindings = grounded.kept.map((draft) => ({
      ...draft,
      title: replaceDocumentIds(draft.title, named),
      description: replaceDocumentIds(draft.description, named),
    }));

    return {
      findings: [...deterministic.findings, ...modelFindings].map((draft) => toFinding(analysisId, draft)),
      missingInformation: deterministic.missingInformation.map((draft) => toFinding(analysisId, draft)),
      summary,
      comparisonTable: deterministic.comparisonTable,
    };
  }

  /** Rejects after `timeoutMs`. The work is marked cancelled so it stops before its next provider call. */
  async function withDeadline<T>(work: Promise<T>, timeoutMs: number, state: RunState): Promise<T> {
    // Prevents an unhandled rejection when the work fails after the deadline has already won the race.
    work.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        state.cancelled = true;
        reject(new AnalysisTimeoutError());
      }, timeoutMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    async run(request: AnalysisRequest): Promise<AnalysisResult> {
      const startedAt = Date.now();
      const { usable, problems } = resolveDocuments(request.documentIds);

      if (usable.length === 0) {
        throw new AppError(
          409,
          'NO_USABLE_DOCUMENTS',
          'None of the selected documents are ready for analysis. Wait for processing to finish or upload them again.',
          { problems },
        );
      }

      const analysisId = randomUUID();
      analyses.create({
        id: analysisId,
        instruction: request.instruction,
        provider: provider.name,
        documentIds: usable.map((doc) => doc.documentId),
        createdAt: new Date().toISOString(),
      });
      analyses.updateStatus(analysisId, 'running');
      logger.info('analysis started', {
        analysisId,
        documents: usable.length,
        skipped: problems.length,
        provider: provider.name,
      });

      const state: RunState = {
        cancelled: false,
        facts: [],
        warnings: problems.map((p) => `Skipped ${p.originalName ?? 'an unknown document'}: ${describeProblem(p)}.`),
      };

      let outcome: RunOutcome;
      try {
        const stages = await withDeadline(
          executeStages(analysisId, request.instruction, usable, state),
          options.timeoutMs,
          state,
        );
        outcome = {
          status: 'completed',
          facts: state.facts,
          findings: [...stages.findings, ...stages.missingInformation],
          summary: stages.summary,
          comparisonTable: stages.comparisonTable,
          warnings: state.warnings,
          completedAt: new Date().toISOString(),
        };
      } catch (err) {
        outcome = {
          status: 'failed',
          facts: state.facts,
          warnings: state.warnings,
          errorMessage: safeErrorMessage(err),
          completedAt: new Date().toISOString(),
        };
        logger.warn('analysis failed', {
          analysisId,
          reason: err instanceof Error ? err.name : 'unknown',
          factsKept: state.facts.length,
        });
      }

      analyses.persistRun(analysisId, outcome);
      logger.info('analysis finished', {
        analysisId,
        status: outcome.status,
        facts: state.facts.length,
        totalMs: Date.now() - startedAt,
      });

      const result = analyses.getFullAnalysis(analysisId);
      if (!result) throw new Error(`Analysis ${analysisId} was not found after it was persisted.`);
      return result;
    },
  };
}

function describeProblem(problem: DocumentProblem): string {
  switch (problem.reason) {
    case 'not found':
      return 'the document does not exist';
    case 'text unavailable':
      return 'its text is not available';
    case 'uploaded':
    case 'processing':
      return `it is still ${problem.reason}`;
    default:
      return `its status is "${problem.reason}"`;
  }
}

function toFinding(analysisId: string, draft: CrossDocumentAnalysisOutput['findings'][number]): Finding {
  return {
    id: randomUUID(),
    analysisId,
    type: draft.type,
    title: draft.title,
    description: draft.description,
    severity: draft.severity,
    sources: draft.sources,
    isInterpretation: true,
  };
}
