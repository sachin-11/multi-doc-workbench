/*
 * Key and value normalisation for the deterministic cross-document comparison.
 *
 * Models name the same field in different ways ("applicant_name", "director_name", "annual_revenue_2025",
 * "revenue_figure"), and they write the same value in different formats ("INR 4,80,00,000", "4.8 crore",
 * "31-03-2027", "2027-03-31", "Pvt Ltd", "Private Limited"). Comparing raw strings would report
 * formatting as disagreement, or miss a real disagreement hidden under a different key.
 *
 * Everything here is pure and deterministic. It never calls a model.
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export interface NormalizedKey {
  /** Concept the field belongs to, for example "applicant_name", "licence_expiry", "revenue". */
  base: string;
  /** Reporting period such as "fy2025", when the key names one. */
  period: string | null;
  /** base plus period. Facts with the same key are compared with each other. */
  key: string;
}

/** Tokens that change from document to document without changing the meaning of the field. */
const FILLER_TOKENS = new Set([
  'annual',
  'total',
  'declared',
  'registered',
  'trade',
  'the',
  'of',
  'no',
  'nos',
  'num',
  'number',
  'name',
  'figure',
  'figures',
  'amount',
  'value',
  'and',
]);

const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  license: 'licence',
  licenses: 'licence',
  licences: 'licence',
  expiration: 'expiry',
  expires: 'expiry',
  expire: 'expiry',
  expiring: 'expiry',
  validity: 'expiry',
  valid: 'expiry',
  until: 'expiry',
  upto: 'expiry',
  directors: 'director',
  turnover: 'revenue',
  sales: 'revenue',
  addr: 'address',
};

const COMPANY_TOKENS = new Set(['company', 'business', 'organisation', 'organization', 'entity', 'firm', 'legal', 'trading']);
const PERSON_TOKENS = new Set([
  'applicant',
  'director',
  'holder',
  'borrower',
  'customer',
  'owner',
  'full',
  'account',
  'proprietor',
  'signatory',
  'promoter',
]);
const LICENCE_QUALIFIERS = new Set(['issue', 'issued', 'date', 'authority', 'type', 'status', 'category', 'holder']);

/** Fields where a gap between documents matters: names, address, licence number and expiry, revenue, directors. */
const IMPORTANT_BASES = new Set(['applicant_name', 'company', 'address', 'licence', 'licence_expiry', 'revenue', 'co_director']);

const LABELS: Readonly<Record<string, string>> = {
  applicant_name: 'Applicant / director name',
  company: 'Company name',
  address: 'Registered address',
  licence: 'Licence number',
  licence_expiry: 'Licence expiry date',
  revenue: 'Revenue',
  co_director: 'Co-director',
};

/** Generated keys such as "amount_1" are positional, not names of a field, so they cannot be compared. */
const POSITIONAL_KEY = /^(?:amount|date|email)_\d+$/;

export function isPositionalKey(key: string): boolean {
  return POSITIONAL_KEY.test(key);
}

function toFinancialYear(digits: string): string {
  return digits.length === 2 ? `fy20${digits}` : `fy${digits}`;
}

/** Splits a key into tokens and pulls out the reporting period ("fy2025", "fy_2025", "2025", "fy25"). */
function splitPeriod(tokens: readonly string[]): { rest: string[]; period: string | null } {
  const rest: string[] = [];
  let period: string | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    const next = tokens[i + 1] ?? '';
    const fy = /^fy(\d{4}|\d{2})$/.exec(token);
    if (fy?.[1]) {
      period = toFinancialYear(fy[1]);
    } else if (token === 'fy' && /^\d{2}(?:\d{2})?$/.test(next)) {
      period = toFinancialYear(next);
      i += 1;
    } else if (/^20\d{2}$/.test(token) && tokens.length > 1) {
      period = `fy${token}`;
    } else {
      rest.push(token);
    }
  }
  return { rest, period };
}

function applyAliases(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    if (token === 'codirector') {
      out.push('co', 'director');
      continue;
    }
    const mapped = TOKEN_ALIASES[token] ?? token;
    if (out[out.length - 1] !== mapped) out.push(mapped);
  }
  return out;
}

function baseConcept(tokens: readonly string[]): string {
  const has = (word: string): boolean => tokens.includes(word);

  if (has('licence')) {
    if (has('expiry')) return 'licence_expiry';
    if (!tokens.some((t) => LICENCE_QUALIFIERS.has(t))) return 'licence';
    return tokens.join('_');
  }
  if (has('address') && !has('email')) return 'address';
  if (has('co') && has('director')) return 'co_director';
  if (tokens.length === 1 && tokens[0] === 'revenue') return 'revenue';
  if (tokens.length > 0 && tokens.every((t) => COMPANY_TOKENS.has(t))) return 'company';
  if (tokens.length > 0 && tokens.every((t) => PERSON_TOKENS.has(t))) return 'applicant_name';
  if (tokens.length === 1 && tokens[0] === 'name') return 'applicant_name';
  return tokens.join('_');
}

/**
 * Maps a raw fact key to the concept it names. Synonyms collapse to one concept, so
 * "applicant_name", "director_name", "directors" and a bare "name" are one field, and
 * "annual_revenue_2025", "revenue_fy2025" and "turnover_fy25" are one field.
 */
export function normalizeKey(rawKey: string): NormalizedKey {
  const tokens = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0);

  const { rest, period } = splitPeriod(tokens);
  const aliased = applyAliases(rest);
  const meaningful = aliased.filter((t) => !FILLER_TOKENS.has(t));
  // A key made only of filler ("name", "total") keeps its words, so it still has a meaning.
  const base = baseConcept(meaningful.length > 0 ? meaningful : aliased) || 'field';
  return { base, period, key: period ? `${base}_${period}` : base };
}

export function isImportantBase(base: string): boolean {
  return IMPORTANT_BASES.has(base);
}

function humanize(base: string): string {
  const words = base.split('_').filter((w) => w.length > 0);
  const text = words.join(' ');
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : 'Field';
}

/** Human-readable field name for titles and table rows, for example "Revenue FY2025". */
export function labelFor(key: NormalizedKey): string {
  const label = LABELS[key.base] ?? humanize(key.base);
  return key.period ? `${label} ${key.period.toUpperCase()}` : label;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A value that says the information is absent. It is a gap, not a value to compare. */
const ABSENT_WHOLE =
  /^\s*(?:n\/?a|nil|none|null|unknown|not applicable|not available|not provided|not recorded|not stated|not disclosed|not mentioned|missing|unavailable|undisclosed|tbd|[-–—]+)\s*\.?\s*$/i;
const ABSENT_SENTENCE =
  /^\s*(?:no|not)\s+[\s\S]*\b(?:recorded|provided|available|stated|disclosed|mentioned|specified|given|found|applicable|declared|reported|listed|submitted|included|captured)\b/i;

/**
 * True for values such as "No revenue figure is recorded in this summary" or "Not provided".
 * These count as missing information, never as a value that differs from other documents.
 */
export function isAbsenceStatement(value: string): boolean {
  return ABSENT_WHOLE.test(value) || ABSENT_SENTENCE.test(value);
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Parses common date formats to ISO "YYYY-MM-DD". Numeric dates are read day first, as in Indian documents. */
function parseDate(value: string): string | null {
  const text = value.trim().replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    // Day first. Only when that is impossible (month > 12) is it read month first.
    return second > 12 && first <= 12
      ? isoDate(Number(m[3]), first, second)
      : isoDate(Number(m[3]), second, first);
  }

  m = /^(\d{1,2})[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4})$/i.exec(text);
  if (m) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()];
    return month ? isoDate(Number(m[3]), month, Number(m[1])) : null;
  }

  m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  if (m) {
    const month = MONTHS[(m[1] ?? '').toLowerCase()];
    return month ? isoDate(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

const UNIT_MULTIPLIER: Readonly<Record<string, number>> = {
  crore: 1e7, crores: 1e7, cr: 1e7,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5,
  million: 1e6, mn: 1e6,
  billion: 1e9, bn: 1e9,
  thousand: 1e3, k: 1e3,
};

const CURRENCY_CODE: Readonly<Record<string, string>> = {
  inr: '', 'rs.': '', rs: '', '₹': '',
  usd: 'usd:', 'us$': 'usd:', $: 'usd:',
  eur: 'eur:', '€': 'eur:',
  gbp: 'gbp:', '£': 'gbp:',
};

const MONEY =
  /^(?:(inr|rs\.?|₹|usd|us\$|\$|eur|€|gbp|£)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|million|mn|billion|bn|thousand|k)?\s*(?:(inr|rs|usd|eur|gbp)\b)?\s*(?:\/-|only)?\s*$/i;

/**
 * Parses an amount to a canonical number string. The Indian digit grouping ("4,80,00,000"), an
 * "INR"/"Rs"/"₹" prefix and units such as "crore" and "lakh" are all understood. Rupees are the default
 * currency, so "INR 4,80,00,000" equals "4,80,00,000". Other currencies keep a prefix.
 */
function parseMoney(value: string): string | null {
  const m = MONEY.exec(value.trim());
  if (!m) return null;
  const digits = (m[2] ?? '').replace(/,/g, '');
  let amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  const unit = (m[3] ?? '').toLowerCase();
  if (unit) amount *= UNIT_MULTIPLIER[unit] ?? 1;
  const currency = CURRENCY_CODE[(m[1] ?? m[4] ?? '').toLowerCase()] ?? '';
  return `${currency}${Math.round(amount * 100) / 100}`;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^(?:mr|mrs|ms|miss|dr|shri|smt|sri)\b\.?\s+/, '')
    .replace(/\bpvt\b\.?/g, 'private')
    .replace(/\bltd\b\.?/g, 'limited')
    .replace(/\bsec(?:tor)?\.?\s*(\d+)/g, 'sector $1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Canonical form of a value for comparison. Dates become ISO dates, amounts become plain numbers,
 * and text ignores case, punctuation, spacing and company suffix variants ("Pvt Ltd" = "Private Limited").
 * Two values with the same canonical form differ only in formatting.
 */
export function normalizeValue(value: string): string {
  return parseDate(value) ?? parseMoney(value) ?? normalizeText(value);
}
