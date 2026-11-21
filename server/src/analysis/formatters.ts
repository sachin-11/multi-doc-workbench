import type { AnalysisResult, ExtractedFact, Finding } from '@mdw/shared';

/*
 * Output formatting. Pure functions, no I/O. The markdown export is the single source for the
 * frontend copy button (it calls GET /api/analyses/:id/export?format=markdown).
 */

export interface DocumentLabel {
  originalName: string;
}

/** Document names are user input. Brackets and newlines would break the markdown source line. */
function safeLabel(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/([\[\]])/g, '\\$1');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Table cells: no pipes or newlines. */
function cell(text: string | null): string {
  if (text === null) return '—';
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function sourcesLabel(finding: Finding, documentsById: ReadonlyMap<string, DocumentLabel>): string {
  const names = unique(
    finding.sources.map((source) => safeLabel(documentsById.get(source.documentId)?.originalName ?? source.documentId)),
  );
  return `[Source: ${names.join(', ')}]`;
}

function renderFinding(finding: Finding, documentsById: ReadonlyMap<string, DocumentLabel>): string {
  const severity = finding.severity ? ` (severity: ${finding.severity})` : '';
  return `- **${oneLine(finding.title)}**${severity}: ${oneLine(finding.description)} ${sourcesLabel(finding, documentsById)}`;
}

function renderFact(fact: ExtractedFact): string {
  const normalized = fact.normalizedValue && fact.normalizedValue !== fact.value ? ` (normalised: ${fact.normalizedValue})` : '';
  return `- \`${fact.key}\`: ${oneLine(fact.value)}${normalized} · confidence ${fact.confidence.toFixed(2)} · quote: "${oneLine(fact.sourceSnippet)}"`;
}

function renderComparisonTable(result: AnalysisResult, documentsById: ReadonlyMap<string, DocumentLabel>): string[] {
  const table = result.comparisonTable;
  if (!table) return ['_No comparison table was produced._'];

  const headers = table.columns.map((id) => safeLabel(documentsById.get(id)?.originalName ?? id));
  const lines = [
    `| Field | ${headers.join(' | ')} | Consistent |`,
    `| --- | ${headers.map(() => '---').join(' | ')} | --- |`,
  ];
  for (const row of table.rows) {
    const values = table.columns.map((id) => cell(row.values[id] ?? null));
    lines.push(`| ${cell(row.field)} | ${values.join(' | ')} | ${row.consistent === null ? 'single source' : row.consistent ? 'yes' : 'no'} |`);
  }
  return lines;
}

function renderFactsByDocument(result: AnalysisResult, documentsById: ReadonlyMap<string, DocumentLabel>): string[] {
  const lines: string[] = [];
  for (const documentId of result.documentIds) {
    const name = safeLabel(documentsById.get(documentId)?.originalName ?? documentId);
    lines.push(`### ${name}`, '');
    const facts = result.perDocumentFacts[documentId] ?? [];
    lines.push(...(facts.length === 0 ? ['_No facts were extracted from this document._'] : facts.map(renderFact)), '');
  }
  return lines;
}

/**
 * Markdown report. Facts (what documents say) and AI interpretation (what the model concluded) are
 * in separate sections. Every interpretation line ends with its sources.
 */
export function toMarkdown(result: AnalysisResult, documentsById: ReadonlyMap<string, DocumentLabel>): string {
  const lines: string[] = [];
  const section = (title: string, body: string[]) => lines.push(`## ${title}`, '', ...body, '');

  const discrepancies = result.findings.filter((f) => f.type === 'discrepancy');
  const otherFindings = result.findings.filter((f) => f.type !== 'discrepancy');

  lines.push('# Document analysis', '');
  lines.push(`**Instruction:** ${oneLine(result.instruction)}`);
  lines.push(
    `**Status:** ${result.status} · **Provider:** ${result.provider} · **Documents:** ${result.documentIds.length}`,
    '',
  );
  if (result.errorMessage) lines.push(`> Analysis failed: ${oneLine(result.errorMessage)}`, '');

  section('Summary (AI interpretation)', [result.summary ? oneLine(result.summary) : '_No summary was produced._']);
  section('Comparison table (AI interpretation)', renderComparisonTable(result, documentsById));
  section(
    'Discrepancies (AI interpretation)',
    discrepancies.length === 0 ? ['_No discrepancies were found._'] : discrepancies.map((f) => renderFinding(f, documentsById)),
  );
  section(
    'Missing information (AI interpretation)',
    result.missingInformation.length === 0
      ? ['_No missing information was found._']
      : result.missingInformation.map((f) => renderFinding(f, documentsById)),
  );
  if (otherFindings.length > 0) {
    section(
      'Other findings (AI interpretation)',
      otherFindings.map((f) => renderFinding(f, documentsById)),
    );
  }
  section('Extracted facts (stated in the documents, not AI interpretation)', renderFactsByDocument(result, documentsById));

  if (result.warnings.length > 0) {
    section('Warnings', result.warnings.map((w) => `- ${oneLine(w)}`));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Safe download name. The id is a UUID, so it cannot contain path characters. */
export function exportFileName(result: AnalysisResult, format: 'markdown' | 'json'): string {
  return `analysis-${result.id}.${format === 'markdown' ? 'md' : 'json'}`;
}
