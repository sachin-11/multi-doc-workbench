import type {
  ComparisonRow,
  CrossDocumentAnalysisOutput,
  ExtractedFact,
  Finding,
  FindingSource,
} from '@mdw/shared';
import type { CrossDocumentPayload } from './prompts.js';

/*
 * Rule-based cross-document analysis for the MOCK provider. Works on structured facts only.
 * Facts are compared by key. Values are compared after normalising case, whitespace, commas
 * and currency symbols.
 */

type FindingDraft = Omit<Finding, 'id' | 'analysisId' | 'isInterpretation'>;

/**
 * Normalises a value for comparison: case, spacing, currency symbols and Indian digit grouping ("4,80,00,000")
 * are ignored, and company suffix variants are expanded ("Pvt Ltd" = "Private Limited").
 */
export function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bpvt\b\.?/g, 'private')
    .replace(/\bltd\b\.?/g, 'limited')
    .replace(/[₹$£€,\s.]/g, '');
}

function sourceFor(doc: { documentId: string }, fact: ExtractedFact): FindingSource {
  return { documentId: doc.documentId, factId: fact.id, snippet: fact.sourceSnippet };
}

export function analyzeFacts(payload: CrossDocumentPayload): CrossDocumentAnalysisOutput {
  const docs = payload.documents;
  const columns = docs.map((d) => d.documentId);

  // key -> documentId -> facts for that key in that document
  const byKey = new Map<string, Map<string, ExtractedFact[]>>();
  for (const doc of docs) {
    for (const fact of doc.facts) {
      const perDoc = byKey.get(fact.key) ?? new Map<string, ExtractedFact[]>();
      const list = perDoc.get(doc.documentId) ?? [];
      list.push(fact);
      perDoc.set(doc.documentId, list);
      byKey.set(fact.key, perDoc);
    }
  }

  const findings: FindingDraft[] = [];
  const missingInformation: FindingDraft[] = [];
  const rows: ComparisonRow[] = [];

  for (const key of [...byKey.keys()].sort()) {
    const perDoc = byKey.get(key);
    if (!perDoc) continue;

    const values: Record<string, string | null> = {};
    const presentDocs = docs.filter((d) => perDoc.has(d.documentId));
    for (const doc of docs) {
      values[doc.documentId] = perDoc.get(doc.documentId)?.[0]?.value ?? null;
    }

    const distinct = new Set(presentDocs.map((d) => normalizeForComparison(values[d.documentId] ?? '')));
    const allPresent = presentDocs.length === docs.length;
    const consistent = allPresent && distinct.size === 1;
    rows.push({ field: key, values, consistent });

    const sourcesFromPresent: FindingSource[] = presentDocs.flatMap((d) =>
      (perDoc.get(d.documentId) ?? []).slice(0, 1).map((fact) => sourceFor(d, fact)),
    );
    const category = presentDocs[0] && perDoc.get(presentDocs[0].documentId)?.[0]?.category;

    if (presentDocs.length >= 2 && distinct.size > 1) {
      const describe = presentDocs
        .map((d) => `${d.originalName}: "${values[d.documentId] ?? ''}"`)
        .join('; ');
      findings.push({
        type: 'discrepancy',
        title: `${key} differs between documents`,
        description: `The documents state different values. ${describe}.`,
        severity: category === 'financial' || category === 'identity' ? 'high' : 'medium',
        sources: sourcesFromPresent,
      });
    } else if (presentDocs.length >= 2 && consistent) {
      findings.push({
        type: 'comparison',
        title: `${key} matches across documents`,
        description: `All ${docs.length} documents state the same value: "${values[presentDocs[0]?.documentId ?? ''] ?? ''}".`,
        severity: null,
        sources: sourcesFromPresent,
      });
    }

    if (!allPresent && presentDocs.length >= 1) {
      const absent = docs.filter((d) => !perDoc.has(d.documentId)).map((d) => d.originalName);
      // Cite every document: present ones with their fact, absent ones with no snippet.
      const sources: FindingSource[] = docs.map((d) => {
        const fact = perDoc.get(d.documentId)?.[0];
        return fact ? sourceFor(d, fact) : { documentId: d.documentId, factId: null, snippet: null };
      });
      missingInformation.push({
        type: 'missing_information',
        title: `${key} is missing from ${absent.join(', ')}`,
        description: `"${key}" is stated in ${presentDocs.map((d) => d.originalName).join(', ')} but not in ${absent.join(', ')}.`,
        severity: category === 'identity' || category === 'financial' ? 'high' : 'low',
        sources,
      });
    }
  }

  const discrepancyCount = findings.filter((f) => f.type === 'discrepancy').length;
  const summary =
    docs.length === 0
      ? null
      : `Compared ${docs.length} document(s) across ${byKey.size} extracted field(s): ${discrepancyCount} discrepancy(ies) and ${missingInformation.length} missing field(s). Values were compared after normalising case, spacing and currency symbols.`;

  return {
    findings,
    missingInformation,
    comparisonTable: columns.length === 0 ? null : { columns, rows },
    summary,
  };
}
