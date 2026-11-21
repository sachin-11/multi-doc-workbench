import type { CrossDocumentAnalysisOutput } from '@mdw/shared';
import { describeComparison } from '../analysis/summary.js';
import type { CrossDocumentPayload } from './prompts.js';

/*
 * Stage B for the MOCK provider. It plays the model's part under the current contract: the comparison table,
 * the discrepancies and the missing information are computed in code (analysis/comparison.ts), so the mock
 * returns only a summary. It writes that summary from the verified comparison in the prompt, the way a real
 * model is told to. It adds no extra findings and ignores the free-text instruction.
 */
export function analyzeFacts(payload: CrossDocumentPayload): CrossDocumentAnalysisOutput {
  const docs = payload.documents;
  const verified = payload.verifiedComparison;

  let summary: string | null = null;
  if (docs.length > 0) {
    summary = verified
      ? describeComparison({
          documentCount: docs.length,
          discrepancies: verified.discrepancies.map((d) => d.field),
          missing: verified.missing.map((m) => m.field),
          consistentCount: verified.consistentFields.length,
        })
      : `Read ${docs.length} document(s) and ${docs.reduce((n, d) => n + d.facts.length, 0)} extracted fact(s).`;
  }

  return { findings: [], missingInformation: [], comparisonTable: null, summary };
}
