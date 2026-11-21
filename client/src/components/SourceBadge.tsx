import { useId } from 'react';

export interface SourceBadgeProps {
  documentId: string;
  documentName: string;
  factId: string | null;
  snippet: string | null;
  /** Called on click. The parent switches to the Extracted facts tab and highlights this source. */
  onSelect?: (documentId: string, factId: string | null) => void;
}

/**
 * Names a supporting document. Hover or keyboard focus shows the quoted snippet; click jumps to the
 * document's facts. Keyboard users get the same snippet through aria-describedby.
 */
export function SourceBadge({ documentId, documentName, factId, snippet, onSelect }: SourceBadgeProps) {
  const tipId = useId();
  return (
    <span className="source-wrap">
      <button
        type="button"
        className="source-badge"
        aria-describedby={snippet ? tipId : undefined}
        aria-label={`Source: ${documentName}. Show the supporting fact.`}
        onClick={() => onSelect?.(documentId, factId)}
      >
        {documentName}
      </button>
      {snippet && (
        <span role="tooltip" id={tipId} className="source-popover">
          &ldquo;{snippet}&rdquo;
        </span>
      )}
    </span>
  );
}
