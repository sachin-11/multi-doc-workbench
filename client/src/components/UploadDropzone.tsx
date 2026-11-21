import { useRef, useState, type DragEvent } from 'react';
import type { LimitsResponse } from '@mdw/shared';

export interface UploadDropzoneProps {
  limits: LimitsResponse | null;
  busy: boolean;
  onFiles: (files: File[]) => void;
}

/** Drag-and-drop and file picker. Shows the allowed types and limits; the server still validates everything. */
export function UploadDropzone({ limits, busy, onFiles }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };

  const accept = limits ? limits.allowedExtensions.filter((ext) => ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg').join(',') : '.pdf,.txt,.csv';

  return (
    <div
      className={`dropzone${dragging ? ' dropzone-active' : ''}${busy ? ' dropzone-busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <p className="dropzone-text">Drag files here, or</p>
      <button type="button" className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
        Choose files
      </button>
      <input
        ref={inputRef}
        id="file-input"
        type="file"
        multiple
        accept={accept}
        className="visually-hidden"
        aria-label="Choose documents to upload"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <p className="muted small">
        {limits
          ? `PDF, TXT or CSV. Up to ${limits.maxFiles} files per upload, ${limits.maxFileSizeMb} MB each.`
          : 'PDF, TXT or CSV. Limits could not be loaded; the server will still check each file.'}
      </p>
    </div>
  );
}
