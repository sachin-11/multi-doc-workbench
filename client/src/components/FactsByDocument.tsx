import { useEffect, useState } from 'react';
import type { ExtractedFact } from '@mdw/shared';
import { Tag } from './Tag';

export interface FocusTarget {
  documentId: string;
  factId: string | null;
  /** Changes on every click, so selecting the same source twice still scrolls. */
  nonce: number;
}

export interface FactsByDocumentProps {
  documentIds: readonly string[];
  perDocumentFacts: Readonly<Record<string, readonly ExtractedFact[]>>;
  documentNames: ReadonlyMap<string, string>;
  focus: FocusTarget | null;
}

/** Facts grouped per document, in accordions. A source click opens the document and highlights its fact. */
export function FactsByDocument({ documentIds, perDocumentFacts, documentNames, focus }: FactsByDocumentProps) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(documentIds.slice(0, 1)));
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (!focus) return;
    setOpenIds((prev) => new Set(prev).add(focus.documentId));
    setHighlightId(focus.factId);
    // Scroll after the accordion has opened. Content inside a closed <details> is not visible yet.
    const frame = requestAnimationFrame(() => {
      const target = focus.factId
        ? document.getElementById(`fact-${focus.factId}`)
        : document.getElementById(`doc-${focus.documentId}`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="facts">
      <p className="section-note">
        <Tag kind="fact" /> Extracted from each document, as the document states it. These are not AI conclusions.
      </p>
      {documentIds.map((id) => {
        const facts = perDocumentFacts[id] ?? [];
        const name = documentNames.get(id) ?? 'Unknown document';
        const open = openIds.has(id);
        return (
          <section key={id} id={`doc-${id}`} className="accordion">
            <button
              type="button"
              className="accordion-toggle"
              aria-expanded={open}
              aria-controls={`facts-${id}`}
              onClick={() => toggle(id)}
            >
              <span>{name}</span>
              <span className="muted">
                {facts.length} fact{facts.length === 1 ? '' : 's'}
              </span>
            </button>
            <div id={`facts-${id}`} className="accordion-body" hidden={!open}>
              {facts.length === 0 ? (
                <p className="muted">No facts were extracted from this document.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Key</th>
                        <th scope="col">Value</th>
                        <th scope="col">Category</th>
                        <th scope="col">Confidence</th>
                        <th scope="col">Snippet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facts.map((fact) => (
                        <tr
                          key={fact.id}
                          id={`fact-${fact.id}`}
                          className={highlightId === fact.id ? 'row-focus' : undefined}
                        >
                          <th scope="row">
                            <code>{fact.key}</code>
                          </th>
                          <td>{fact.value}</td>
                          <td>{fact.category}</td>
                          <td>{fact.confidence.toFixed(2)}</td>
                          <td className="snippet">&ldquo;{fact.sourceSnippet}&rdquo;</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
