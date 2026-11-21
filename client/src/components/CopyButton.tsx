import { useEffect, useState } from 'react';
import type { ExportFormat } from '@mdw/shared';
import { exportAnalysis } from '../api/client';

export interface CopyButtonsProps {
  analysisId: string;
}

interface Fallback {
  format: ExportFormat;
  text: string;
}

const TOAST_MS = 2000;

/**
 * Copy and download. The text always comes from GET /api/analyses/:id/export, so copied output matches
 * the server's formatting. If the clipboard is blocked, the text is shown for manual copy.
 */
export function CopyButtons({ analysisId }: CopyButtonsProps) {
  const [busy, setBusy] = useState<ExportFormat | 'download' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<Fallback | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const fetchExport = async (format: ExportFormat): Promise<string | null> => {
    try {
      return await exportAnalysis(analysisId, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the export.');
      return null;
    }
  };

  const copy = async (format: ExportFormat) => {
    setBusy(format);
    setError(null);
    setFallback(null);
    const text = await fetchExport(format);
    if (text !== null) {
      try {
        await navigator.clipboard.writeText(text);
        setToast(`Copied as ${format === 'markdown' ? 'Markdown' : 'JSON'}`);
      } catch {
        setFallback({ format, text });
      }
    }
    setBusy(null);
  };

  const download = async () => {
    setBusy('download');
    setError(null);
    const text = await fetchExport('markdown');
    if (text !== null) {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `analysis-${analysisId}.md`;
      link.click();
      URL.revokeObjectURL(url);
    }
    setBusy(null);
  };

  const disabled = busy !== null;
  return (
    <div className="copy-tools">
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void copy('markdown')} disabled={disabled}>
          Copy as Markdown
        </button>
        <button type="button" className="btn" onClick={() => void copy('json')} disabled={disabled}>
          Copy JSON
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void download()} disabled={disabled}>
          Download .md
        </button>
      </div>
      <div role="status" aria-live="polite" className="toast-region">
        {toast && <span className="toast">{toast}</span>}
      </div>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      {fallback && (
        <div className="fallback">
          <label htmlFor="copy-fallback">
            Clipboard access is blocked. Select the text below and press Ctrl+C (or Cmd+C).
          </label>
          <textarea
            id="copy-fallback"
            readOnly
            rows={8}
            value={fallback.text}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}
