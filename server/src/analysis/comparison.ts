import type {
  ComparisonRow,
  ComparisonTable,
  CrossDocumentAnalysisOutput,
  ExtractedFact,
  FindingSource,
} from '@mdw/shared';
import {
  isAbsenceStatement,
  isImportantBase,
  isPositionalKey,
  labelFor,
  normalizeKey,
  normalizeValue,
  type NormalizedKey,
} from './normalize.js';
import { inferDocType, isExpected } from './docTypes.js';
import { describeComparison } from './summary.js';

/*
 * Deterministic cross-document comparison. Pure code, no model.
 *
 * The comparison table, the discrepancies and the missing-information items are computed here from the
 * extracted facts, so they cannot contain a value that no document states. The model is used only for the
 * summary and for extra points relevant to the instruction (see grounding.ts for how those are checked).
 *
 * Steps: normalise each fact's key (synonyms, period) and value (numbers, dates, company suffixes), group
 * the facts of all documents by normalised key, then read the findings off each group.
 */

export type FindingDraft = CrossDocumentAnalysisOutput['findings'][number];

export interface ComparisonDocument {
  documentId: string;
  originalName: string;
}

interface ValueEntry {
  fact: ExtractedFact;
  /** Canonical form of the value. Equal canonical forms differ only in formatting. */
  norm: string;
}

/** What one document says about one field: values, and statements that the information is absent. */
interface Cell {
  values: ValueEntry[];
  absences: ExtractedFact[];
}

interface Group {
  key: NormalizedKey;
  cells: Map<string, Cell>;
}

/** The verified results in a form that goes into the model prompt, so the summary can rely on them. */
export interface VerifiedComparison {
  discrepancies: { field: string; values: { document: string; value: string }[] }[];
  /** presentIn and absentFrom hold document file names. */
  missing: { field: string; presentIn: string[]; absentFrom: string[] }[];
  consistentFields: string[];
}

export interface DeterministicComparison {
  comparisonTable: ComparisonTable;
  /** Discrepancies first, then matches of important fields. */
  findings: FindingDraft[];
  missingInformation: FindingDraft[];
  verified: VerifiedComparison;
  fallbackSummary: string;
  /** Keys that already have a discrepancy or comparison finding. Used to drop duplicate model findings. */
  coveredKeys: ReadonlySet<string>;
  /** factId -> comparison key, after synonyms and period merging. */
  factKeys: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by grounding.ts)
// ---------------------------------------------------------------------------

const MAX_QUOTE = 140;
const MAX_NAME_LIST = 150;
const MAX_VERIFIED_ITEMS = 50;

/** Quotes a value for a description. Long values are shortened. */
export function quote(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return `"${text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1)}…` : text}"`;
}

export interface DocumentValues {
  documentName: string;
  values: readonly string[];
}

/** "form.pdf: "A"; letter.txt: "B"". Every value comes from a fact, never from model text. */
export function describeValues(entries: readonly DocumentValues[]): string {
  return entries.map((e) => `${e.documentName}: ${e.values.map(quote).join(' / ')}`).join('; ');
}

function joinNames(names: readonly string[]): string {
  const text = names.join(', ');
  return text.length > MAX_NAME_LIST ? `${text.slice(0, MAX_NAME_LIST - 1)}…` : text;
}

export function sourceOf(documentId: string, fact: Pick<ExtractedFact, 'id' | 'sourceSnippet'>): FindingSource {
  return { documentId, factId: fact.id, snippet: fact.sourceSnippet };
}

/**
 * Documents agree when every pair of them shares at least one canonical value. A document that lists two
 * people (applicant and director) still agrees with one that lists only the director. Single-valued fields
 * behave exactly like an equality check.
 */
export function valuesAgree(sets: readonly ReadonlySet<string>[]): boolean {
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i] ?? new Set<string>();
      const b = sets[j] ?? new Set<string>();
      if (![...a].some((value) => b.has(value))) return false;
    }
  }
  return true;
}

/**
 * Severity by field, not by fact category.
 * high: licence number and expiry, revenue, applicant name (a conflict, or missing where it is expected).
 * medium: address, co-director, company name. Other fields: medium for a conflict, low when missing.
 * low (set where the finding is built): formatting-only differences.
 */
const HIGH_BASES = new Set(['applicant_name', 'licence', 'licence_expiry', 'revenue']);
const MEDIUM_BASES = new Set(['address', 'co_director', 'company']);

export function differenceSeverity(base: string): 'medium' | 'high' {
  return HIGH_BASES.has(base) ? 'high' : 'medium';
}

function missingSeverity(base: string): 'low' | 'medium' | 'high' {
  if (HIGH_BASES.has(base)) return 'high';
  return MEDIUM_BASES.has(base) ? 'medium' : 'low';
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function bySeverity(a: FindingDraft, b: FindingDraft): number {
  return (SEVERITY_ORDER[a.severity ?? 'low'] ?? 2) - (SEVERITY_ORDER[b.severity ?? 'low'] ?? 2);
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function buildGroups(
  docs: readonly ComparisonDocument[],
  factsByDocument: ReadonlyMap<string, readonly ExtractedFact[]>,
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const doc of docs) {
    for (const fact of factsByDocument.get(doc.documentId) ?? []) {
      if (isPositionalKey(fact.key) || fact.value.trim().length === 0) continue;
      const key = normalizeKey(fact.key);
      const group = groups.get(key.key) ?? { key, cells: new Map<string, Cell>() };
      groups.set(key.key, group);
      const cell = group.cells.get(doc.documentId) ?? { values: [], absences: [] };
      group.cells.set(doc.documentId, cell);
      // "No revenue figure is recorded" is a gap, never a value to compare.
      if (isAbsenceStatement(fact.value)) cell.absences.push(fact);
      else cell.values.push({ fact, norm: normalizeValue(fact.value) });
    }
  }
  return groups;
}

function valueDocumentCount(group: Group): number {
  let count = 0;
  for (const cell of group.cells.values()) if (cell.values.length > 0) count += 1;
  return count;
}

/**
 * A fact with no period ("revenue_figure") joins the one period that at least two documents state
 * ("revenue_fy2025"). When that choice is not clear, it stays in its own group.
 */
function mergePeriodless(groups: Map<string, Group>): void {
  const periodized = new Map<string, Group[]>();
  for (const group of groups.values()) {
    if (group.key.period === null) continue;
    periodized.set(group.key.base, [...(periodized.get(group.key.base) ?? []), group]);
  }

  for (const [mapKey, group] of [...groups.entries()]) {
    if (group.key.period !== null) continue;
    const candidates = (periodized.get(group.key.base) ?? []).filter((g) => valueDocumentCount(g) >= 2);
    const target = candidates.length === 1 ? candidates[0] : undefined;
    if (!target) continue;

    for (const [documentId, cell] of [...group.cells.entries()]) {
      const existing = target.cells.get(documentId);
      if (existing && existing.values.length > 0) continue; // this document already states the period
      target.cells.set(documentId, {
        values: [...(existing?.values ?? []), ...cell.values],
        absences: [...(existing?.absences ?? []), ...cell.absences],
      });
      group.cells.delete(documentId);
    }
    if (group.cells.size === 0) groups.delete(mapKey);
  }
}

const ROW_ORDER = ['applicant_name', 'company', 'address', 'licence', 'licence_expiry', 'revenue', 'co_director'];

function rowRank(base: string): number {
  const index = ROW_ORDER.indexOf(base);
  return index === -1 ? ROW_ORDER.length : index;
}

function distinctByNorm(entries: readonly ValueEntry[]): ValueEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.norm)) return false;
    seen.add(entry.norm);
    return true;
  });
}

function uniqueFacts(entries: readonly ValueEntry[]): ExtractedFact[] {
  const seen = new Set<string>();
  const facts: ExtractedFact[] = [];
  for (const { fact } of entries) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    facts.push(fact);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compares the facts of two or more documents. Every document is a column of the table, whether or not it
 * states a given field. `docs` must contain at least two documents.
 */
export function compareFacts(
  docs: readonly ComparisonDocument[],
  factsByDocument: ReadonlyMap<string, readonly ExtractedFact[]>,
): DeterministicComparison {
  const groups = buildGroups(docs, factsByDocument);
  mergePeriodless(groups);
  const docTypes = new Map(
    docs.map((d) => [d.documentId, inferDocType(d.originalName, factsByDocument.get(d.documentId) ?? [])] as const),
  );

  // For a field reported per period, only the most widely stated period is checked for gaps. A prior-year
  // figure that only one document carries is not a gap in the others.
  const widestPeriod = new Map<string, number>();
  for (const group of groups.values()) {
    widestPeriod.set(group.key.base, Math.max(widestPeriod.get(group.key.base) ?? 0, valueDocumentCount(group)));
  }

  const ordered = [...groups.values()].sort(
    (a, b) => rowRank(a.key.base) - rowRank(b.key.base) || a.key.key.localeCompare(b.key.key),
  );

  const rows: ComparisonRow[] = [];
  const discrepancies: FindingDraft[] = [];
  const comparisons: FindingDraft[] = [];
  const missingInformation: FindingDraft[] = [];
  const covered = new Set<string>();
  const factKeys = new Map<string, string>();
  const verified: VerifiedComparison = { discrepancies: [], missing: [], consistentFields: [] };

  for (const group of ordered) {
    for (const cell of group.cells.values()) {
      for (const entry of cell.values) factKeys.set(entry.fact.id, group.key.key);
      for (const fact of cell.absences) factKeys.set(fact.id, group.key.key);
    }

    const present = docs.filter((d) => (group.cells.get(d.documentId)?.values.length ?? 0) > 0);
    if (present.length === 0) continue;

    const label = labelFor(group.key);
    const perDoc = present.map((doc) => {
      const all = group.cells.get(doc.documentId)?.values ?? [];
      return { doc, all, distinct: distinctByNorm(all) };
    });
    const agree = valuesAgree(perDoc.map((p) => new Set(p.distinct.map((e) => e.norm))));

    rows.push({
      field: label,
      values: Object.fromEntries(
        docs.map((d) => {
          const distinct = distinctByNorm(group.cells.get(d.documentId)?.values ?? []);
          return [d.documentId, distinct.length > 0 ? distinct.map((e) => e.fact.value).join('; ') : null];
        }),
      ),
      // A field that only one document states cannot be consistent or inconsistent.
      consistent: present.length < 2 ? null : agree,
    });

    const described = describeValues(
      perDoc.map((p) => ({ documentName: p.doc.originalName, values: p.distinct.map((e) => e.fact.value) })),
    );
    // All facts of every document that has the field, so every document's value is cited.
    const sources = perDoc.flatMap((p) => uniqueFacts(p.all).map((fact) => sourceOf(p.doc.documentId, fact)));

    if (present.length >= 2 && !agree) {
      discrepancies.push({
        type: 'discrepancy',
        title: `${label} differs between documents`,
        description: `The documents disagree on ${label}. ${described}.`,
        severity: differenceSeverity(group.key.base),
        sources,
      });
      covered.add(group.key.key);
      verified.discrepancies.push({
        field: label,
        values: perDoc.flatMap((p) =>
          p.distinct.map((e) => ({ document: p.doc.originalName, value: e.fact.value })),
        ),
      });
    } else if (present.length >= 2) {
      verified.consistentFields.push(label);
      if (isImportantBase(group.key.base)) {
        // Same canonical value but written differently ("Pvt Ltd" and "Private Limited") is a low-severity note.
        const writtenForms = new Set(perDoc.flatMap((p) => p.all.map((e) => e.fact.value.replace(/\s+/g, ' ').trim())));
        const formattingOnly = writtenForms.size > 1;
        comparisons.push({
          type: 'comparison',
          title: `${label} matches across documents`,
          description: formattingOnly
            ? `The documents agree on ${label} once formatting is ignored. ${described}.`
            : `All ${present.length} documents that state ${label} give the same value. ${described}.`,
          severity: formattingOnly ? 'low' : null,
          sources,
        });
        covered.add(group.key.key);
      }
    }

    // Only documents whose type is expected to contain the field count as gaps.
    const absent = docs.filter(
      (d) => !present.includes(d) && isExpected(docTypes.get(d.documentId) ?? null, group.key.base),
    );
    const reportsGaps =
      group.key.period === null || present.length >= (widestPeriod.get(group.key.base) ?? 0);
    if (isImportantBase(group.key.base) && absent.length > 0 && reportsGaps) {
      const absenceNotes = absent.flatMap((d) => {
        const statement = group.cells.get(d.documentId)?.absences[0];
        return statement ? [`${d.originalName} says: ${quote(statement.sourceSnippet)}.`] : [];
      });
      missingInformation.push({
        type: 'missing_information',
        title: `${label} is missing from ${joinNames(absent.map((d) => d.originalName))}`,
        description: [
          `${label} is stated in ${joinNames(present.map((d) => d.originalName))} but not in ${joinNames(absent.map((d) => d.originalName))}.`,
          ...absenceNotes,
        ].join(' '),
        severity: missingSeverity(group.key.base),
        // Cited: documents that state the field (with their fact) and the expected-but-missing ones
        // (with their statement of absence, if any).
        sources: [...present, ...absent].map((d) => {
          const cell = group.cells.get(d.documentId);
          const value = cell?.values[0];
          if (value) return sourceOf(d.documentId, value.fact);
          const statement = cell?.absences[0];
          if (statement) return sourceOf(d.documentId, statement);
          return { documentId: d.documentId, factId: null, snippet: null };
        }),
        });
      verified.missing.push({
        field: label,
        presentIn: present.map((d) => d.originalName),
        absentFrom: absent.map((d) => d.originalName),
      });
    }
  }

  const findings = [...discrepancies.sort(bySeverity), ...comparisons];
  missingInformation.sort(bySeverity);

  verified.discrepancies = verified.discrepancies.slice(0, MAX_VERIFIED_ITEMS);
  verified.missing = verified.missing.slice(0, MAX_VERIFIED_ITEMS);

  return {
    comparisonTable: { columns: docs.map((d) => d.documentId), rows },
    findings,
    missingInformation,
    verified,
    fallbackSummary: describeComparison({
      documentCount: docs.length,
      discrepancies: verified.discrepancies.map((d) => d.field),
      missing: verified.missing.map((m) => m.field),
      consistentCount: verified.consistentFields.length,
    }),
    coveredKeys: covered,
    factKeys,
  };
}
