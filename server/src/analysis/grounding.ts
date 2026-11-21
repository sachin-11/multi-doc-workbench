import type { ExtractedFact } from '@mdw/shared';
import {
  describeValues,
  differenceSeverity,
  sourceOf,
  valuesAgree,
  type FindingDraft,
} from './comparison.js';
import { isAbsenceStatement, labelFor, normalizeKey, normalizeValue } from './normalize.js';

/*
 * Value grounding for model findings.
 *
 * A model can cite the right documents and still state the wrong value for one of them ("the form says
 * Rohan Mehra" when the extracted fact is "Rohan Mehta"). Id checks cannot catch that, because the ids are
 * valid. So a discrepancy or comparison finding from the model is accepted only when:
 *   - every source cites a specific fact that belongs to that document;
 *   - the cited facts come from at least two documents and describe one field;
 *   - the cited values really differ (discrepancy) or really agree (comparison).
 * The title and description are then REBUILT from the cited facts' actual values. Nothing the model wrote
 * about a value survives. A finding that fails a check is dropped with a warning.
 *
 * Other finding types (summary points, key values) are free interpretation and are not rewritten.
 */

export interface GroundingContext {
  factById: ReadonlyMap<string, ExtractedFact>;
  documentNames: ReadonlyMap<string, string>;
  /** factId -> comparison key from the deterministic comparison. */
  factKeys: ReadonlyMap<string, string>;
  /** Keys the deterministic comparison already reports. A model finding on them is a duplicate. */
  coveredKeys: ReadonlySet<string>;
}

export interface GroundingResult {
  kept: FindingDraft[];
  warnings: string[];
}

type Outcome =
  | { kind: 'keep'; finding: FindingDraft; rewritten: boolean }
  | { kind: 'drop'; reason: string | null };

const drop = (reason: string | null): Outcome => ({ kind: 'drop', reason });

function ground(draft: FindingDraft, ctx: GroundingContext): Outcome {
  // 1. Every source must cite a fact that exists and belongs to the cited document.
  const cited: { documentId: string; fact: ExtractedFact }[] = [];
  for (const source of draft.sources) {
    const fact = source.factId === null ? undefined : ctx.factById.get(source.factId);
    if (!fact) return drop('a source does not cite a specific extracted fact');
    if (fact.documentId !== source.documentId) return drop('a source cites a fact from another document');
    cited.push({ documentId: source.documentId, fact });
  }

  // 2. Facts from at least two documents, all describing the same field.
  const documentIds = new Set(cited.map((c) => c.documentId));
  if (documentIds.size < 2) return drop('it cites fewer than two documents');
  const keys = new Set(cited.map((c) => ctx.factKeys.get(c.fact.id) ?? normalizeKey(c.fact.key).key));
  if (keys.size > 1) return drop('it compares facts about different fields');
  const [key] = [...keys];
  if (key !== undefined && ctx.coveredKeys.has(key)) return drop(null); // already reported from the facts

  // 3. Facts that only say "not recorded" are gaps, not values.
  const valued = cited.filter((c) => !isAbsenceStatement(c.fact.value));
  const valuedDocuments = new Set(valued.map((c) => c.documentId));
  if (valuedDocuments.size < 2) return drop('fewer than two of the cited documents state a value');

  const byDocument = new Map<string, ExtractedFact[]>();
  for (const { documentId, fact } of valued) {
    byDocument.set(documentId, [...(byDocument.get(documentId) ?? []), fact]);
  }
  const sets = [...byDocument.values()].map((facts) => new Set(facts.map((f) => normalizeValue(f.value))));
  const agree = valuesAgree(sets);
  if (draft.type === 'discrepancy' && agree) return drop('the cited values do not differ');
  if (draft.type === 'comparison' && !agree) return drop('the cited values do not agree');

  // 4. Rebuild the wording from the facts.
  const first = valued[0]?.fact;
  if (!first) return drop('no usable fact');
  const label = labelFor(normalizeKey(first.key));
  const described = describeValues(
    [...byDocument.entries()].map(([documentId, facts]) => ({
      documentName: ctx.documentNames.get(documentId) ?? 'Unknown document',
      values: [...new Set(facts.map((f) => f.value))],
    })),
  );

  const isDiscrepancy = draft.type === 'discrepancy';
  const finding: FindingDraft = {
    type: draft.type,
    title: isDiscrepancy ? `${label} differs between documents` : `${label} matches across documents`,
    description: isDiscrepancy
      ? `The documents disagree on ${label}. ${described}.`
      : `The documents agree on ${label}. ${described}.`,
    // Severity comes from the field, not from the model, so the rules are the same for every finding.
    severity: isDiscrepancy ? differenceSeverity(normalizeKey(first.key).base) : draft.severity,
    sources: valued.map((c) => sourceOf(c.documentId, c.fact)),
  };

  const text = draft.description.toLowerCase();
  const missingValue = !valued.every((c) => text.includes(c.fact.value.trim().toLowerCase()));
  const swapped = pairsWrongValue(draft.description, byDocument, ctx.documentNames);
  return { kind: 'keep', finding, rewritten: missingValue || swapped };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects the usual hallucination: the value that belongs to one document is attached to another, as in
 * `application_form.pdf states "Rohan Mehra"` when that document's fact says "Rohan Mehta". It looks for a quoted
 * value right after a document name and reports true when that value is another document's, not its own.
 * This only decides whether to warn. The wording is rebuilt from the facts either way.
 */
function pairsWrongValue(
  description: string,
  byDocument: ReadonlyMap<string, readonly ExtractedFact[]>,
  names: ReadonlyMap<string, string>,
): boolean {
  const own = new Map<string, Set<string>>();
  for (const [documentId, facts] of byDocument) {
    own.set(documentId, new Set(facts.map((f) => normalizeValue(f.value))));
  }

  for (const [documentId, ownValues] of own) {
    const name = names.get(documentId);
    if (!name) continue;
    const match = new RegExp(`${escapeRegExp(name)}[^"“'‘]{0,40}["“'‘]([^"”'’]{1,200})["”'’]`, 'i').exec(description);
    const quoted = match?.[1];
    if (!quoted) continue;
    const value = normalizeValue(quoted);
    if (ownValues.has(value)) continue;
    const belongsToAnother = [...own.entries()].some(([id, values]) => id !== documentId && values.has(value));
    if (belongsToAnother) return true;
  }
  return false;
}

/**
 * Applies value grounding to the model's discrepancy and comparison findings. Run it after the id guards
 * (provenance and fact ownership), so factIds are already known to be real.
 */
export function groundModelFindings(drafts: readonly FindingDraft[], ctx: GroundingContext): GroundingResult {
  const kept: FindingDraft[] = [];
  const warnings: string[] = [];

  for (const draft of drafts) {
    if (draft.type !== 'discrepancy' && draft.type !== 'comparison') {
      kept.push(draft);
      continue;
    }
    const outcome = ground(draft, ctx);
    if (outcome.kind === 'drop') {
      if (outcome.reason) warnings.push(`An AI finding was dropped ("${draft.title}"): ${outcome.reason}.`);
      continue;
    }
    if (outcome.rewritten) {
      warnings.push(
        `The AI's wording for "${draft.title}" did not match the extracted values, so it was rewritten from the facts.`,
      );
    }
    kept.push(outcome.finding);
  }
  return { kept, warnings };
}
