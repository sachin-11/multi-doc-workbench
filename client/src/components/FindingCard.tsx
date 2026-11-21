import { useId } from 'react';
import type { Finding, FindingSource } from '@mdw/shared';
import { Tag } from './Tag';
import { SeverityChip } from './StatusChip';
import { SourceBadge } from './SourceBadge';

export type SourceSelect = (documentId: string, factId: string | null) => void;

export interface FindingCardProps {
  finding: Finding;
  /** documentId -> display name. Unknown ids fall back to a neutral label. */
  documentNames: ReadonlyMap<string, string>;
  onSourceSelect?: SourceSelect;
}

/** One badge per document, even when several facts from it support the finding. */
function uniqueByDocument(sources: readonly FindingSource[]): FindingSource[] {
  const seen = new Map<string, FindingSource>();
  for (const source of sources) {
    const existing = seen.get(source.documentId);
    // Keep the first source that has a snippet, so the tooltip shows a quote when one exists.
    if (!existing || (existing.snippet === null && source.snippet !== null)) {
      seen.set(source.documentId, source);
    }
  }
  return [...seen.values()];
}

/** AI interpretation card. Every finding shows its source badges, or an explicit "No source" warning. */
export function FindingCard({ finding, documentNames, onSourceSelect }: FindingCardProps) {
  const headingId = useId();
  const sources = uniqueByDocument(finding.sources);

  return (
    <article
      className={`card card-ai${finding.severity ? ` card-sev-${finding.severity}` : ''}`}
      aria-labelledby={headingId}
    >
      <header className="card-header">
        <Tag kind="ai" />
        <h3 id={headingId} className="card-title">
          {finding.title}
        </h3>
        {finding.severity && <SeverityChip severity={finding.severity} />}
      </header>
      <p className="card-body">{finding.description}</p>
      <div className="sources" aria-label="Sources">
        {sources.length === 0 ? (
          <span className="no-source" role="alert">
            No source: this finding cannot be traced to a document.
          </span>
        ) : (
          sources.map((source) => (
            <SourceBadge
              key={source.documentId}
              documentId={source.documentId}
              documentName={documentNames.get(source.documentId) ?? 'Unknown document'}
              factId={source.factId}
              snippet={source.snippet}
              onSelect={onSourceSelect}
            />
          ))
        )}
      </div>
    </article>
  );
}
