/*
 * Plain-language summary built from the verified comparison. Used as the fallback when the model returns
 * no summary, and by the MOCK provider (which has no language ability of its own).
 */

export interface ComparisonDigest {
  documentCount: number;
  /** Labels of the fields that differ between documents. */
  discrepancies: readonly string[];
  /** Labels of important fields missing from at least one document. */
  missing: readonly string[];
  /** Number of fields that every document stating them agrees on. */
  consistentCount: number;
}

const MAX_LISTED = 8;

function list(labels: readonly string[]): string {
  const shown = labels.slice(0, MAX_LISTED).join(', ');
  const rest = labels.length - MAX_LISTED;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

export function describeComparison(digest: ComparisonDigest): string {
  const parts: string[] = [`Compared ${digest.documentCount} documents.`];

  parts.push(
    digest.discrepancies.length > 0
      ? `${digest.discrepancies.length} discrepanc${digest.discrepancies.length === 1 ? 'y' : 'ies'} found: ${list(digest.discrepancies)}.`
      : 'No discrepancies were found.',
  );
  parts.push(
    digest.missing.length > 0
      ? `${digest.missing.length} important field${digest.missing.length === 1 ? ' is' : 's are'} missing from at least one document: ${list(digest.missing)}.`
      : 'No important fields are missing.',
  );
  parts.push(
    `${digest.consistentCount} field${digest.consistentCount === 1 ? '' : 's'} agree across the documents that state them.`,
  );
  return parts.join(' ');
}

/**
 * Replaces document ids (the full id, or the first eight characters that models like to quote) with the
 * document's file name. A model sometimes writes "document e7fa67fd" even when told not to.
 */
export function replaceDocumentIds(
  text: string,
  docs: readonly { documentId: string; originalName: string }[],
): string {
  let out = text;
  for (const doc of docs) {
    out = out.split(doc.documentId).join(doc.originalName);
    // "\\b" in a template string is a regex word boundary. A single "\b" would be a backspace character.
    out = out.replace(new RegExp(`\\b${doc.documentId.slice(0, 8)}\\b`, 'gi'), doc.originalName);
  }
  return out;
}
