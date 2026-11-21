import type { PerDocumentExtractionOutput } from '@mdw/shared';

/*
 * Rule-based extraction for the MOCK provider. No network, deterministic.
 * Every sourceSnippet is an exact substring of the input text, so the snippet guard always passes.
 */

type Fact = PerDocumentExtractionOutput['facts'][number];

const MAX_SNIPPET = 200;
const LABEL_LINE = /^[ \t]*([A-Za-z][A-Za-z0-9 _/().-]{1,60}?)[ \t]*:[ \t]*(\S.*?)[ \t]*$/gm;
// The label part of a CSV row line ("Row 3") has no colon, so match it without one.
const CSV_ROW_LABEL = /^Row \d+$/i;
const CSV_PAIR = /([A-Za-z][A-Za-z0-9 _-]*?)=([^;\n]+)/g;
const CURRENCY = /(?:₹|\$|£|€|USD|INR|EUR|GBP)\s?\d[\d,]*(?:\.\d+)?/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;

/** "Applicant Name" -> "applicant_name". Always lower snake_case, never empty. */
export function toSnakeKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

/*
 * Filler words that differ between documents for the same field:
 * "Annual Revenue FY2025" vs "Revenue FY2025", "Trade Licence No" vs "Licence No", "Company name" vs "Company".
 * The period token (fy2025) is kept, so figures for different years are never compared with each other.
 */
const FILLER_TOKENS = new Set(['annual', 'total', 'declared', 'registered', 'trade', 'the', 'of', 'no', 'number', 'name']);
const TOKEN_ALIASES: Readonly<Record<string, string>> = { directors: 'director' };

/**
 * Canonical key used for comparison across documents: snake_case, filler words removed, simple aliases applied.
 * Falls back to the plain snake_case key when every token is filler (e.g. a bare "Name").
 */
export function canonicalKey(label: string): string {
  const tokens = toSnakeKey(label)
    .split('_')
    .filter((token) => token.length > 0 && !FILLER_TOKENS.has(token))
    .map((token) => TOKEN_ALIASES[token] ?? token);
  const key = tokens.join('_').slice(0, 100);
  return key.length > 0 ? key : toSnakeKey(label);
}

/** Columns that name the row in a long-form table (one metric per row, one column per period). */
const ROW_LABEL_COLUMNS = new Set(['metric', 'metrics', 'item', 'line_item', 'particulars', 'description', 'line']);

/** The first column name from the CSV parser's "Columns:" line, if there is one. */
function firstColumnOf(text: string): string | null {
  const line = /^Columns: (.*)$/m.exec(text);
  const first = line?.[1]?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/** Category from a key, checked in a fixed order so results are stable. */
export function categorize(key: string): Fact['category'] {
  if (/licen[cs]e/.test(key)) return 'licence';
  if (
    /revenue|income|amount|total|fee|price|cost|salary|turnover|balance|payment|tax|value|profit|debt|liabilit|asset|cash|equit|loan/.test(
      key,
    )
  ) {
    return 'financial';
  }
  if (/date|due|expir|issued|start|end|period|renew|deadline/.test(key)) return 'date';
  if (/address|street|postcode|postal|zip|city/.test(key)) return 'address';
  if (/name|applicant|holder|owner|director|company|customer|person|email|phone/.test(key)) return 'identity';
  if (/obligation|must|shall|requirement/.test(key)) return 'obligation';
  return 'other';
}

function normalizedOf(value: string, category: Fact['category']): string {
  if (category === 'financial') {
    return value.replace(/[₹$£€,\s]|USD|INR|EUR|GBP/g, '').toLowerCase();
  }
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function clampSnippet(text: string): string {
  return text.length > MAX_SNIPPET ? text.slice(0, MAX_SNIPPET) : text;
}

export function extractFactsFromText(text: string): Fact[] {
  const facts: Fact[] = [];
  const covered: Array<[number, number]> = [];

  // 1. "Key: Value" lines (labelled fields are the strongest signal).
  for (const match of text.matchAll(LABEL_LINE)) {
    const label = match[1] ?? '';
    const value = (match[2] ?? '').trim();
    const start = match.index ?? 0;
    covered.push([start, start + match[0].length]);

    if (CSV_ROW_LABEL.test(label.trim()) || /^columns$/i.test(label.trim())) continue;
    const key = canonicalKey(label);
    if (toSnakeKey(label).length === 0 || value.length === 0) continue;

    const category = categorize(key);
    facts.push({
      key,
      value: value.slice(0, 1000),
      normalizedValue: normalizedOf(value, category),
      category,
      sourceSnippet: clampSnippet(match[0].trim()),
      confidence: 0.9,
    });
  }

  // 2. CSV "Row n: column=value; ..." lines produced by the CSV parser.
  // In a long-form table ("metric" first, one column per year), the row label is combined with each column:
  // "metric=revenue; fy2025=4,10,00,000" becomes the fact revenue_fy2025.
  const firstColumn = firstColumnOf(text);
  const hasRowLabelColumn = firstColumn !== null && ROW_LABEL_COLUMNS.has(toSnakeKey(firstColumn));
  for (const match of text.matchAll(/^Row \d+:.*$/gm)) {
    const line = match[0];
    const start = match.index ?? 0;
    covered.push([start, start + line.length]);
    const pairs = [...line.slice(line.indexOf(':') + 1).matchAll(CSV_PAIR)];
    const labelPair = hasRowLabelColumn ? pairs[0] : undefined;
    const rowLabel = labelPair ? (labelPair[2] ?? '').trim() : '';
    const useRowLabel = labelPair !== undefined && rowLabel.length > 0 && rowLabel !== '(empty)';

    pairs.forEach((pair, index) => {
      if (useRowLabel && index === 0) return; // the row label itself is not a fact
      const column = pair[1]?.trim() ?? '';
      const value = (pair[2] ?? '').trim();
      if (value.length === 0 || value === '(empty)') return;
      const key = canonicalKey(useRowLabel ? `${rowLabel} ${column}` : column);
      if (toSnakeKey(column).length === 0) return;
      const category = categorize(key);
      facts.push({
        key,
        value: value.slice(0, 1000),
        normalizedValue: normalizedOf(value, category),
        category,
        // A composite fact (metric + period) quotes the whole row, so the metric name is visible in the snippet.
        sourceSnippet: clampSnippet(useRowLabel ? line.trim() : pair[0].trim()),
        confidence: 0.85,
      });
    });
  }

  // 3. Unlabelled currency, email and date mentions outside the lines above.
  const inCovered = (index: number): boolean => covered.some(([s, e]) => index >= s && index < e);
  let amount = 0;
  for (const match of text.matchAll(CURRENCY)) {
    if (inCovered(match.index ?? 0)) continue;
    amount += 1;
    facts.push({
      key: `amount_${amount}`,
      value: match[0],
      normalizedValue: normalizedOf(match[0], 'financial'),
      category: 'financial',
      sourceSnippet: match[0],
      confidence: 0.6,
    });
  }
  let email = 0;
  for (const match of text.matchAll(EMAIL)) {
    if (inCovered(match.index ?? 0)) continue;
    email += 1;
    facts.push({
      key: `email_${email}`,
      value: match[0],
      normalizedValue: match[0].toLowerCase(),
      category: 'identity',
      sourceSnippet: match[0],
      confidence: 0.9,
    });
  }
  let date = 0;
  for (const match of text.matchAll(ISO_DATE)) {
    if (inCovered(match.index ?? 0)) continue;
    date += 1;
    facts.push({
      key: `date_${date}`,
      value: match[0],
      normalizedValue: match[0],
      category: 'date',
      sourceSnippet: match[0],
      confidence: 0.6,
    });
  }

  return dedupe(facts);
}

function dedupe(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const id = `${fact.key}\u0000${fact.value}\u0000${fact.sourceSnippet}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
