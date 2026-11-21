import type { DocumentStatus } from '@mdw/shared';

const LABELS: Record<DocumentStatus, string> = {
  uploaded: 'Queued',
  processing: 'Processing',
  processed: 'Ready',
  failed: 'Failed',
  unsupported: 'Unsupported',
};

/** Document processing status. The text is the label, so colour is never the only signal. */
export function StatusChip({ status }: { status: DocumentStatus }) {
  return <span className={`chip chip-${status}`}>{LABELS[status]}</span>;
}

export function SeverityChip({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  return <span className={`chip chip-severity-${severity}`}>Severity: {severity}</span>;
}
