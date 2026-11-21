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

/** Stage 2 (cross-document): operates on structured facts only, never on raw document text. */
export const CrossDocumentAnalysisOutputSchema = z.object({
  findings: z.array(FindingDraftSchema),
  missingInformation: z.array(FindingDraftSchema),
  comparisonTable: ComparisonTableSchema.nullable(),
  summary: z.string().max(4000).nullable(),
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
