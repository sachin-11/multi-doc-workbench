import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentDetail, DocumentMeta, UploadResponse } from '@mdw/shared';
import { ApiRequestError, deleteDocument, getDocumentDetail, listDocuments, uploadDocuments } from '../api/client';

const POLL_INTERVAL_MS = 1500;

function isPending(doc: DocumentMeta): boolean {
  return doc.status === 'uploaded' || doc.status === 'processing';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * Document list state: loads, polls while any document is still uploaded or processing, uploads, deletes,
 * and tracks which processed documents are included in the analysis. Everything processed is included by
 * default; the user can untick documents, and newly processed ones are included unless unticked.
 */
export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(new Set());
  const [detailsById, setDetailsById] = useState<Readonly<Record<string, DocumentDetail>>>({});

  const refresh = useCallback(async () => {
    try {
      setDocuments(await listDocuments());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pending = documents.some(isPending);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  // Warnings (truncation, parser notes) live on the detail endpoint. Fetch once per processed document.
  const processedKey = documents
    .filter((d) => d.status === 'processed')
    .map((d) => d.id)
    .join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of processedKey ? processedKey.split(',') : []) {
      if (detailsById[id]) continue;
      getDocumentDetail(id)
        .then((detail) => {
          if (!cancelled) setDetailsById((prev) => ({ ...prev, [id]: detail }));
        })
        .catch(() => {
          // Warnings are optional. The row still shows status and errors.
        });
    }
    return () => {
      cancelled = true;
    };
    // detailsById is read only to skip cached entries; re-running on each change is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedKey]);

  const processedIds = useMemo(
    () => documents.filter((d) => d.status === 'processed').map((d) => d.id),
    [documents],
  );
  const selectedIds = useMemo(
    () => processedIds.filter((id) => !excludedIds.has(id)),
    [processedIds, excludedIds],
  );

  const toggleSelected = useCallback((id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const upload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setActionError(null);
      try {
        const result = await uploadDocuments(files);
        setUploadResult(result);
        await refresh();
      } catch (err) {
        setActionError(errorText(err));
      } finally {
        setUploading(false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await deleteDocument(id);
        setExcludedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await refresh();
      } catch (err) {
        // A 409 (used by a saved analysis) arrives here with the server's explanation.
        setActionError(err instanceof ApiRequestError ? err.message : errorText(err));
      }
    },
    [refresh],
  );

  return {
    documents,
    loading,
    loadError,
    actionError,
    dismissActionError: () => setActionError(null),
    uploading,
    uploadResult,
    dismissUploadResult: () => setUploadResult(null),
    upload,
    remove,
    detailsById,
    selectedIds,
    isSelected: (id: string) => !excludedIds.has(id),
    toggleSelected,
    refresh,
  };
}

export type DocumentsState = ReturnType<typeof useDocuments>;
