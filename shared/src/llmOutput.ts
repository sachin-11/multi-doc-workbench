import { z } from 'zod';
import { ExtractedFactSchema } from './facts.js';
import { ComparisonTableSchema, FindingSchema } from './analysis.js';

/*
 * Schemas for validating raw LLM output. The model never sets ids or isInterpretation;
 * the server assigns them after validation.
 */

/** Stage 1 (per document): facts the model found in ONE document. */
export const PerDocumentExtractionOutputSchema = z.object({
  facts: z.array(ExtractedFactSchema.omit({ id: true, documentId: true })),
});
export type PerDocumentExtractionOutput = z.infer<typeof PerDocumentExtractionOutputSchema>;

const FindingDraftSchema = FindingSchema.omit({
  id: true,
  analysisId: true,
  isInterpretation: true,
});

/**
 * Stage 2 (cross-document): operates on structured facts only, never on raw document text.
 *
 * The comparison table and the missing-information list are computed in code, and the prompt tells the model
 * to leave them empty. A model that is told to leave something empty often omits the key, so every field has a
 * default. A reply without those keys is valid, instead of failing the whole analysis on a field nobody uses.
 */
export const CrossDocumentAnalysisOutputSchema = z.object({
  findings: z.array(FindingDraftSchema).default([]),
  missingInformation: z.array(FindingDraftSchema).default([]),
  comparisonTable: ComparisonTableSchema.nullable().default(null),
  summary: z.string().max(4000).nullable().default(null),
});
export type CrossDocumentAnalysisOutput = z.infer<typeof CrossDocumentAnalysisOutputSchema>;

/**
 * Returns the document ids referenced in the output's sources that are NOT part of the analysis.
 * An empty array means every citation points at a document the user actually selected.
 */
export function findUnknownSourceDocumentIds(
  output: CrossDocumentAnalysisOutput,
  allowedDocumentIds: readonly string[],
): string[] {
  const allowed = new Set(allowedDocumentIds);
  const unknown = new Set<string>();
  for (const finding of [...output.findings, ...output.missingInformation]) {
    for (const source of finding.sources) {
      if (!allowed.has(source.documentId)) unknown.add(source.documentId);
    }
  }
  return [...unknown];
}
