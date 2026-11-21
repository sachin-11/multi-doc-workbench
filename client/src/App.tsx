import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LimitsResponse } from '@mdw/shared';
import { fetchLimits } from './api/client';
import { useAnalysis, STAGE_LABELS } from './hooks/useAnalysis';
import { useDocuments } from './hooks/useDocuments';
import { precheckFiles, type FileProblem } from './lib/precheck';
import { DocumentList } from './components/DocumentList';
import { InstructionPanel } from './components/InstructionPanel';
import { ResultsTabs } from './components/ResultsTabs';
import type { FocusTarget } from './components/FactsByDocument';
import type { SourceSelect } from './components/FindingCard';
import { UploadDropzone } from './components/UploadDropzone';
import { Icon } from './components/Icon';
import './styles.css';

interface PrecheckMessage {
  problems: FileProblem[];
  batch: string | null;
}

export function App() {
  const docs = useDocuments();
  const analysis = useAnalysis();
  const [limits, setLimits] = useState<LimitsResponse | null>(null);
  const [instruction, setInstruction] = useState('');
  const [precheck, setPrecheck] = useState<PrecheckMessage | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const nonce = useRef(0);

  useEffect(() => {
    // If limits fail to load, uploads still go through and the server enforces the same rules.
    fetchLimits()
      .then(setLimits)
      .catch(() => setLimits(null));
  }, []);

  const documentNames = useMemo(
    () => new Map(docs.documents.map((d) => [d.id, d.originalName])),
    [docs.documents],
  );

  const onFiles = useCallback(
    (files: File[]) => {
      const check = limits
        ? precheckFiles(files, limits)
        : { accepted: files, problems: [], batchProblem: null };
      setPrecheck({ problems: check.problems, batch: check.batchProblem });
      if (check.batchProblem || check.accepted.length === 0) return;
      void docs.upload(check.accepted);
    },
    [limits, docs],
  );

  const onSourceSelect: SourceSelect = useCallback((documentId, factId) => {
    nonce.current += 1;
    setFocus({ documentId, factId, nonce: nonce.current });
  }, []);

  const selectedCount = docs.selectedIds.length;
  const running = analysis.state.kind === 'running';
  const stageText =
    analysis.state.kind === 'running' ? (STAGE_LABELS[analysis.state.stage] ?? STAGE_LABELS[0]) : null;

  const runAnalysis = () => {
    setFocus(null);
    void analysis.run(docs.selectedIds, instruction.trim());
  };

  const uploadProblems: FileProblem[] = [
    ...(precheck?.problems ?? []),
    ...(docs.uploadResult?.rejected.map((r) => ({ fileName: r.originalName, reason: r.reason })) ?? []),
  ];
  const batchProblem = precheck?.batch ?? null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="layers" size={20} />
          </span>
          <div>
            <h1>Multi-Document Intelligence Workbench</h1>
            <p className="muted brand-subtitle">
              Upload documents, give an instruction, and get findings with the document each one comes from.
            </p>
          </div>
        </div>
      </header>

      <div className="app">

      <main className="layout">
        <section className="card panel-card" aria-labelledby="documents-heading">
          <h2 id="documents-heading">
            <span className="step" aria-hidden="true">
              1
            </span>
            Documents
          </h2>
          <UploadDropzone limits={limits} busy={docs.uploading} onFiles={onFiles} />

          {docs.uploading && (
            <p role="status" className="muted">
              Uploading…
            </p>
          )}
          {batchProblem && (
            <div role="alert" className="alert alert-error">
              {batchProblem}
            </div>
          )}
          {uploadProblems.length > 0 && (
            <div role="alert" className="alert alert-warning">
              <div className="alert-row">
                <strong>Some files were not added</strong>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => {
                    setPrecheck(null);
                    docs.dismissUploadResult();
                  }}
                >
                  Dismiss
                </button>
              </div>
              <ul>
                {uploadProblems.map((p, i) => (
                  <li key={`${i}-${p.fileName}`}>
                    <strong>{p.fileName}:</strong> {p.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {docs.actionError && (
            <div role="alert" className="alert alert-error">
              <div className="alert-row">
                <span>{docs.actionError}</span>
                <button type="button" className="btn btn-ghost btn-small" onClick={docs.dismissActionError}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {docs.loadError && (
            <div role="alert" className="alert alert-error">
              Could not load documents: {docs.loadError}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void docs.refresh()}>
                Retry
              </button>
            </div>
          )}

          {docs.loading && docs.documents.length === 0 && <p className="muted">Loading documents…</p>}
          {!docs.loading && docs.documents.length === 0 && !docs.loadError && (
            <p className="empty-state">No documents yet. Upload a PDF, TXT or CSV file to begin.</p>
          )}
          {docs.documents.length > 0 && (
            <>
              <div className="list-summary">
                <p className="muted small">
                  {selectedCount} of {docs.documents.filter((d) => d.status === 'processed').length} processed
                  document{selectedCount === 1 ? '' : 's'} selected for analysis.
                </p>
              </div>
              <DocumentList
                documents={docs.documents}
                detailsById={docs.detailsById}
                isSelected={docs.isSelected}
                onToggle={docs.toggleSelected}
                onDelete={(id) => void docs.remove(id)}
              />
            </>
          )}
        </section>

        <section className="card panel-card" aria-labelledby="instruction-heading">
          <h2 id="instruction-heading">
            <span className="step" aria-hidden="true">
              2
            </span>
            Instruction
          </h2>
          <InstructionPanel
            value={instruction}
            onChange={setInstruction}
            limits={limits}
            selectedCount={selectedCount}
            running={running}
            stageText={stageText}
            onAnalyse={runAnalysis}
          />
        </section>
      </main>

      <section className="card panel-card results-card" aria-labelledby="results-heading">
        <h2 id="results-heading" className="visually-hidden">
          3. Results
        </h2>
        {analysis.state.kind === 'idle' && (
          <div className="empty-results">
            <span className="icon-bubble" aria-hidden="true">
              <Icon name="sparkles" size={22} />
            </span>
            <p className="empty-state">Results appear here after you run an analysis.</p>
            <ol className="how-it-works">
              <li>Upload two or more documents</li>
              <li>Describe what to compare</li>
              <li>Review findings with their sources</li>
            </ol>
          </div>
        )}
        {analysis.state.kind === 'running' && (
          <div className="skeleton" aria-hidden="true">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
          </div>
        )}
        {analysis.state.kind === 'error' && (
          <div role="alert" className="alert alert-error">
            The analysis could not run: {analysis.state.message}
          </div>
        )}
        {analysis.state.kind === 'done' && (
          <ResultsTabs
            result={analysis.state.result}
            documentNames={documentNames}
            focus={focus}
            onSourceSelect={onSourceSelect}
          />
        )}
      </section>

      <footer className="app-footer">
        Facts show what a document states. AI findings are generated from those facts and always cite their source documents.
      </footer>
      </div>
    </div>
  );
}
