import type { DocumentDetail, DocumentMeta } from '@mdw/shared';
import { formatBytes } from '../lib/precheck';
import { StatusChip } from './StatusChip';
import { Icon } from './Icon';

export interface DocumentListProps {
  documents: readonly DocumentMeta[];
  detailsById: Readonly<Record<string, DocumentDetail>>;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', txt: 'TXT', csv: 'CSV', image: 'Image' };

/** One row per document. Only processed documents can be selected for analysis. */
export function DocumentList({ documents, detailsById, isSelected, onToggle, onDelete }: DocumentListProps) {
  return (
    <ul className="doc-list" aria-label="Uploaded documents">
      {documents.map((doc) => {
        const detail = detailsById[doc.id];
        const warnings = [...(doc.wasTruncated ? ['Text was truncated to the per-document limit.'] : []), ...(detail?.warnings ?? [])];
        const processed = doc.status === 'processed';
        const checkboxId = `select-${doc.id}`;
        return (
          <li key={doc.id} className="doc-row">
            <div className="doc-select">
              <input
                id={checkboxId}
                type="checkbox"
                checked={processed && isSelected(doc.id)}
                disabled={!processed}
                onChange={() => onToggle(doc.id)}
                aria-label={`Include ${doc.originalName} in the analysis`}
                title={processed ? undefined : 'Only processed documents can be analysed'}
              />
            </div>
            <span className={`file-icon file-icon-${doc.format ?? 'unknown'}`} aria-hidden="true">
              {doc.format ? FORMAT_LABEL[doc.format] ?? doc.format : '?'}
            </span>
            <div className="doc-main">
              <div className="doc-title-row">
                <span className="doc-name" title={doc.originalName}>
                  {doc.originalName}
                </span>
                <span className="muted small">{formatBytes(doc.sizeBytes)}</span>
                <StatusChip status={doc.status} />
              </div>
              {doc.errorMessage && (doc.status === 'failed' || doc.status === 'unsupported') && (
                <p className="doc-error" role="note">
                  {doc.errorMessage}
                </p>
              )}
              {warnings.map((w) => (
                <p key={w} className="doc-warning">
                  {w}
                </p>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-danger-ghost btn-small"
              onClick={() => onDelete(doc.id)}
              aria-label={`Delete ${doc.originalName}`}
            >
              <Icon name="trash" size={15} />
              Delete
            </button>
          </li>
        );
      })}
    </ul>
  );
}
