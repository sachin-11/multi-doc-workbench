import type {
  CrossDocumentAnalysisOutput,
  ExtractedFact,
  FindingSource,
} from '@mdw/shared';

/*
 * Post-validation guards. They run on every provider's output, mock or real, because a model can
 * still cite the wrong ids or quote text that is not in the document.
 */

export interface GuardResult<T> {
  cleaned: T;
  warnings: string[];
}

type Draft = CrossDocumentAnalysisOutput['findings'][number];

/** Confidence given to a fact whose quoted text cannot be found in its document. */
export const UNVERIFIED_CONFIDENCE_CAP = 0.3;

function cleanSources(
  sources: readonly FindingSource[],
  allowedDocs: ReadonlySet<string>,
  allowedFacts: ReadonlySet<string>,
  where: string,
  warnings: string[],
): FindingSource[] {
  const kept: FindingSource[] = [];
  for (const source of sources) {
    if (!allowedDocs.has(source.documentId)) {
      warnings.push(`${where}: removed a citation to an unknown documentId`);
      continue;
    }
    let factId = source.factId;
    if (factId !== null && !allowedFacts.has(factId)) {
      warnings.push(`${where}: removed an unknown factId, kept the document citation`);
      factId = null;
    }
    kept.push({ ...source, factId });
  }
  return kept;
}

function cleanFindings(
  findings: readonly Draft[],
  label: string,
  allowedDocs: ReadonlySet<string>,
  allowedFacts: ReadonlySet<string>,
  warnings: string[],
): Draft[] {
  return findings.flatMap((finding, i) => {
    const where = `${label}[${i}]`;
    const sources = cleanSources(finding.sources, allowedDocs, allowedFacts, where, warnings);
    if (sources.length === 0) {
      warnings.push(`${where} "${finding.title}" was dropped: it has no valid source`);
      return [];
    }
    return [{ ...finding, sources }];
  });
}

/**
 * Keeps only citations that point at documents and facts in this analysis. Findings left with no
 * valid source are dropped. Every drop or edit is reported in `warnings`.
 */
export function validateProvenance(
  output: CrossDocumentAnalysisOutput,
  allowedDocumentIds: readonly string[],
  allowedFactIds: readonly string[],
): GuardResult<CrossDocumentAnalysisOutput> {
  const docs = new Set(allowedDocumentIds);
  const facts = new Set(allowedFactIds);
  const warnings: string[] = [];

  const findings = cleanFindings(output.findings, 'findings', docs, facts, warnings);
  const missingInformation = cleanFindings(
    output.missingInformation,
    'missingInformation',
    docs,
    facts,
    warnings,
  );

  let comparisonTable = output.comparisonTable;
  if (comparisonTable) {
    const columns = comparisonTable.columns.filter((id) => docs.has(id));
    if (columns.length !== comparisonTable.columns.length) {
      warnings.push('comparisonTable: removed unknown document columns');
    }
    if (columns.length === 0) {
      warnings.push('comparisonTable was dropped: no known document columns');
      comparisonTable = null;
    } else {
      comparisonTable = {
        columns,
        rows: comparisonTable.rows.map((row) => ({
          ...row,
          values: Object.fromEntries(Object.entries(row.values).filter(([id]) => docs.has(id))),
        })),
      };
    }
  }

  return {
    cleaned: { ...output, findings, missingInformation, comparisonTable },
    warnings,
  };
}

/** Lower-case, single spaces, trimmed. Used for snippet matching. */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Checks that a fact's sourceSnippet really appears in the document text. If it does not, the
 * fact is kept but its confidence is capped and a warning is raised.
 */
export function verifyFact<F extends Pick<ExtractedFact, 'key' | 'sourceSnippet' | 'confidence'>>(
  fact: F,
  documentText: string | undefined,
): { fact: F; verified: boolean; warning?: string } {
  if (documentText === undefined) {
    return {
      fact: { ...fact, confidence: Math.min(fact.confidence, UNVERIFIED_CONFIDENCE_CAP) },
      verified: false,
      warning: `unverified fact "${fact.key}": the source text is not available`,
    };
  }
  if (normalizeForMatch(documentText).includes(normalizeForMatch(fact.sourceSnippet))) {
    return { fact, verified: true };
  }
  return {
    fact: { ...fact, confidence: Math.min(fact.confidence, UNVERIFIED_CONFIDENCE_CAP) },
    verified: false,
    warning: `unverified snippet for "${fact.key}": the quoted text was not found in the document`,
  };
}

/** Applies verifyFact to a list of facts. `textByDocumentId` maps each document to its stored text. */
export function verifyFacts<F extends Pick<ExtractedFact, 'key' | 'sourceSnippet' | 'confidence' | 'documentId'>>(
  facts: readonly F[],
  textByDocumentId: Readonly<Record<string, string>>,
): GuardResult<F[]> {
  const warnings: string[] = [];
  const cleaned = facts.map((fact) => {
    const result = verifyFact(fact, textByDocumentId[fact.documentId]);
    if (result.warning) warnings.push(result.warning);
    return result.fact;
  });
  return { cleaned, warnings };
}
