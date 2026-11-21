import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AnalysisResult, Finding } from '@mdw/shared';
import { ComparisonTable } from './ComparisonTable';
import { CopyButtons } from './CopyButton';
import { FactsByDocument, type FocusTarget } from './FactsByDocument';
import { FindingCard, type SourceSelect } from './FindingCard';
import { Tag } from './Tag';

type TabId = 'summary' | 'comparison' | 'discrepancies' | 'missing' | 'facts';

const PROVIDER_LABEL: Record<AnalysisResult['provider'], string> = { openai: 'OpenAI', mock: 'Mock' };

export interface ResultsTabsProps {
  result: AnalysisResult;
  documentNames: ReadonlyMap<string, string>;
  focus: FocusTarget | null;
  onSourceSelect: SourceSelect;
}

function FindingList({
  findings,
  empty,
  documentNames,
  onSourceSelect,
}: {
  findings: readonly Finding[];
  empty: string;
  documentNames: ReadonlyMap<string, string>;
  onSourceSelect: SourceSelect;
}) {
  if (findings.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="card-list">
      {findings.map((finding) => (
        <FindingCard key={finding.id} finding={finding} documentNames={documentNames} onSourceSelect={onSourceSelect} />
      ))}
    </div>
  );
}

/**
 * Results panel: provider badge, warnings, copy tools, and five tabs. AI interpretation and extracted
 * facts are in separate tabs with separate labels.
 */
export function ResultsTabs({ result, documentNames, focus, onSourceSelect }: ResultsTabsProps) {
  const [tab, setTab] = useState<TabId>('summary');

  // A source click anywhere in the results jumps to the facts it refers to.
  useEffect(() => {
    if (focus) setTab('facts');
  }, [focus]);
  const baseId = useId();
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    summary: null,
    comparison: null,
    discrepancies: null,
    missing: null,
    facts: null,
  });

  const discrepancies = result.findings.filter((f) => f.type === 'discrepancy');
  const matches = result.findings.filter((f) => f.type !== 'discrepancy');
  const factCount = Object.values(result.perDocumentFacts).reduce((total, facts) => total + facts.length, 0);
  const tabs: { id: TabId; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'comparison', label: 'Comparison' },
    { id: 'discrepancies', label: `Discrepancies (${discrepancies.length})` },
    { id: 'missing', label: `Missing information (${result.missingInformation.length})` },
    { id: 'facts', label: 'Extracted facts' },
  ];

  // Left and right arrows move between tabs, as the WAI-ARIA tabs pattern expects.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (!next) return;
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const panelId = (id: TabId) => `${baseId}-panel-${id}`;
  const tabId = (id: TabId) => `${baseId}-tab-${id}`;

  return (
    <section className="results" aria-labelledby={`${baseId}-heading`}>
      <header className="results-header">
        <h2 id={`${baseId}-heading`}>Results</h2>
        <span className="badge provider-badge" title="The model provider that produced the interpretation">
          Provider: {PROVIDER_LABEL[result.provider]}
        </span>
        <span className="muted small">
          {result.documentIds.length} document{result.documentIds.length === 1 ? '' : 's'}
        </span>
      </header>

      {result.status === 'failed' && (
        <div role="alert" className="alert alert-error">
          <strong>The analysis did not finish.</strong> {result.errorMessage}
          {Object.values(result.perDocumentFacts).some((f) => f.length > 0) && (
            <> Facts extracted before the failure are shown in Extracted facts.</>
          )}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="alert alert-warning" role="status">
          <strong>Warnings</strong>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={`${i}-${w}`}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="stats" role="group" aria-label="Analysis overview">
        <div className="stat">
          <span className="stat-value">{result.documentIds.length}</span>
          <span className="stat-label">Documents</span>
        </div>
        <div className="stat">
          <span className="stat-value">{factCount}</span>
          <span className="stat-label">Facts extracted</span>
        </div>
        <div className={`stat${discrepancies.length > 0 ? ' stat-danger' : ''}`}>
          <span className="stat-value">{discrepancies.length}</span>
          <span className="stat-label">Discrepancies found</span>
        </div>
        <div className={`stat${result.missingInformation.length > 0 ? ' stat-warn' : ''}`}>
          <span className="stat-value">{result.missingInformation.length}</span>
          <span className="stat-label">Missing items</span>
        </div>
      </div>

      <CopyButtons analysisId={result.id} />

      <p className="legend">
        <span>
          <Tag kind="fact" /> stated in a document
        </span>
        <span>
          <Tag kind="ai" /> generated by the AI from the facts
        </span>
      </p>

      <div className="tabs" role="tablist" aria-label="Result sections">
        {tabs.map((t, index) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            id={tabId(t.id)}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={panelId(t.id)}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab${tab === t.id ? ' tab-active' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, index)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id={panelId('summary')} role="tabpanel" aria-labelledby={tabId('summary')} hidden={tab !== 'summary'} className="panel">
        <div className="card card-ai">
          <header className="card-header">
            <Tag kind="ai" />
            <h3 className="card-title">Summary</h3>
          </header>
          <p className="card-body">{result.summary ?? 'No summary was produced.'}</p>
        </div>
      </div>

      <div id={panelId('comparison')} role="tabpanel" aria-labelledby={tabId('comparison')} hidden={tab !== 'comparison'} className="panel">
        <div className="card-header">
          <Tag kind="ai" />
          <span className="muted small">Table cells are the values stated by each document. The consistency call is AI interpretation.</span>
        </div>
        {result.comparisonTable ? (
          <ComparisonTable table={result.comparisonTable} documentNames={documentNames} />
        ) : (
          <p className="muted">No comparison table (single-document run or none produced).</p>
        )}
        {matches.length > 0 && (
          <>
            <h3 className="subheading">Other findings</h3>
            <FindingList
              findings={matches}
              empty=""
              documentNames={documentNames}
              onSourceSelect={onSourceSelect}
            />
          </>
        )}
      </div>

      <div id={panelId('discrepancies')} role="tabpanel" aria-labelledby={tabId('discrepancies')} hidden={tab !== 'discrepancies'} className="panel">
        <FindingList
          findings={discrepancies}
          empty="No discrepancies were found."
          documentNames={documentNames}
          onSourceSelect={onSourceSelect}
        />
      </div>

      <div id={panelId('missing')} role="tabpanel" aria-labelledby={tabId('missing')} hidden={tab !== 'missing'} className="panel">
        <FindingList
          findings={result.missingInformation}
          empty="No missing information was found."
          documentNames={documentNames}
          onSourceSelect={onSourceSelect}
        />
      </div>

      <div id={panelId('facts')} role="tabpanel" aria-labelledby={tabId('facts')} hidden={tab !== 'facts'} className="panel">
        <FactsByDocument
          documentIds={result.documentIds}
          perDocumentFacts={result.perDocumentFacts}
          documentNames={documentNames}
          focus={focus}
        />
      </div>
    </section>
  );
}
