import { z } from 'zod';
import { ExtractedFactSchema } from './facts.js';
import { DEFAULT_LIMITS } from './constants.js';

/**
 * INTERPRETATION: everything here is AI-generated analysis across documents.
 * Every finding must cite at least one document in `sources` (provenance).
 */
export const FindingTypeSchema = z.enum([
  'comparison',
  'discrepancy',
  'missing_information',
  'summary_point',
  'key_value',
]);
export type FindingType = z.infer<typeof FindingTypeSchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSourceSchema = z.object({
  documentId: z.uuid(),
  /** Set when the finding is grounded in a specific extracted fact. */
  factId: z.uuid().nullable(),
  snippet: z.string().max(DEFAULT_LIMITS.maxSnippetChars).nullable(),
});
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingSchema = z.object({
  id: z.uuid(),
  analysisId: z.uuid(),
  type: FindingTypeSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  severity: SeveritySchema.nullable(),
  /** Provenance. A finding without at least one source is invalid. */
  sources: z.array(FindingSourceSchema).min(1),
  /** Literal true: marks this record as AI interpretation, not a document fact. */
  isInterpretation: z.literal(true),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ComparisonRowSchema = z.object({
  field: z.string().min(1).max(200),
  /** Value per document id. null when the document does not state the field. */
  values: z.record(z.uuid(), z.string().nullable()),
  consistent: z.boolean(),
});
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

export const ComparisonTableSchema = z.object({
  columns: z.array(z.uuid()).min(1),
  rows: z.array(ComparisonRowSchema),
});
export type ComparisonTable = z.infer<typeof ComparisonTableSchema>;

/** Builds the request schema with the document limit taken from config (MAX_FILES). */
export function createAnalysisRequestSchema(maxDocuments: number) {
  return z.object({
    documentIds: z
      .array(z.uuid())
      .min(1)
      .max(maxDocuments)
      .refine((ids) => new Set(ids).size === ids.length, 'documentIds must be unique'),
    instruction: z
      .string()
      .trim()
      .min(DEFAULT_LIMITS.minInstructionChars)
      .max(DEFAULT_LIMITS.maxInstructionChars),
  });
}
export const AnalysisRequestSchema = createAnalysisRequestSchema(DEFAULT_LIMITS.maxDocumentsPerAnalysis);
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

export const AnalysisStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AnalysisProviderSchema = z.enum(['openai', 'mock']);
export type AnalysisProvider = z.infer<typeof AnalysisProviderSchema>;

/**
 * Full analysis as returned to the client. Facts and interpretation are separate fields:
 * `perDocumentFacts` (what documents say) vs `findings` / `comparisonTable` / `summary` /
 * `missingInformation` (what the AI concluded).
 */
export const AnalysisResultSchema = z.object({
  id: z.uuid(),
  instruction: z.string(),
  status: AnalysisStatusSchema,
  documentIds: z.array(z.uuid()),
  perDocumentFacts: z.record(z.uuid(), z.array(ExtractedFactSchema)),
  findings: z.array(FindingSchema),
  comparisonTable: ComparisonTableSchema.nullable(),
  summary: z.string().nullable(),
  missingInformation: z.array(FindingSchema),
  provider: AnalysisProviderSchema,
  /** Non-fatal notes: skipped documents, failed extraction chunks, guard edits, single-document mode. */
  warnings: z.array(z.string()),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/** One row in GET /api/analyses. */
export const AnalysisSummarySchema = z.object({
  id: z.uuid(),
  instruction: z.string(),
  status: AnalysisStatusSchema,
  documentIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
});
export type AnalysisSummary = z.infer<typeof AnalysisSummarySchema>;

export const AnalysisListResponseSchema = z.object({
  analyses: z.array(AnalysisSummarySchema),
});
export type AnalysisListResponse = z.infer<typeof AnalysisListResponseSchema>;

export const ExportFormatSchema = z.enum(['markdown', 'json']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportQuerySchema = z.object({
  format: ExportFormatSchema.default('markdown'),
});
export type ExportQuery = z.infer<typeof ExportQuerySchema>;
