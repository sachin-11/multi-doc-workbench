import type { ExtractedFact } from '@mdw/shared';
import { isImportantBase, isPositionalKey, normalizeKey } from './normalize.js';

/*
 * Document types and the fields each type is expected to contain. Missing information is only reported for a
 * document when its type is expected to carry the field: a financials CSV has no applicant name, so its
 * absence there is not a gap, while a revenue figure missing from a KYC summary is.
 *
 * The type is inferred from the file name first and from the extracted facts second. Pure and deterministic.
 */

export type DocType = 'application_form' | 'supporting_letter' | 'financials' | 'kyc';

const PEOPLE_AND_PLACE = ['applicant_name', 'company', 'address'] as const;
const LICENCE = ['licence', 'licence_expiry'] as const;

/** Normalised field bases (see normalize.ts) each document type is expected to state. */
export const EXPECTED_BASES: Readonly<Record<DocType, ReadonlySet<string>>> = {
  application_form: new Set([...PEOPLE_AND_PLACE, ...LICENCE, 'revenue', 'co_director']),
  supporting_letter: new Set([...PEOPLE_AND_PLACE, ...LICENCE, 'revenue']),
  financials: new Set(['revenue']),
  kyc: new Set([...PEOPLE_AND_PLACE, ...LICENCE, 'revenue', 'co_director']),
};

export function inferDocTypeFromName(fileName: string): DocType | null {
  const name = fileName.toLowerCase();
  if (/\bkyc\b|kyc[_\-. ]|[_\-. ]kyc/.test(name)) return 'kyc';
  if (/application|loan[_\-. ]?form|(^|[_\-. ])form([_\-. ]|$)/.test(name)) return 'application_form';
  if (/financ|revenue|turnover|statement|ledger|accounts|balance[_\-. ]?sheet|p[_\-. ]?and[_\-. ]?l/.test(name)) {
    return 'financials';
  }
  if (/letter|support|confirmation|attestation|certificate/.test(name)) return 'supporting_letter';
  if (name.endsWith('.csv')) return 'financials';
  return null;
}

/** Name first. When the name says nothing, a document that only states revenue-like fields is financials. */
export function inferDocType(fileName: string, facts: readonly ExtractedFact[]): DocType | null {
  const byName = inferDocTypeFromName(fileName);
  if (byName) return byName;

  const bases = new Set(
    facts.filter((f) => !isPositionalKey(f.key) && f.value.trim().length > 0).map((f) => normalizeKey(f.key).base),
  );
  const important = [...bases].filter(isImportantBase);
  if (important.length > 0 && important.every((b) => b === 'revenue')) return 'financials';
  return null;
}

/** An unknown type is expected to carry everything, which is the conservative reading. */
export function isExpected(type: DocType | null, base: string): boolean {
  return type === null || EXPECTED_BASES[type].has(base);
}
