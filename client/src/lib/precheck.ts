import { EXTENSION_TO_FORMAT, type LimitsResponse } from '@mdw/shared';

/*
 * Client-side pre-check for friendly messages before upload. The server re-validates every file,
 * so this is a convenience and never the only check.
 */

export interface FileProblem {
  fileName: string;
  reason: string;
}

export interface PrecheckResult {
  accepted: File[];
  problems: FileProblem[];
  /** Set when the whole batch is refused (for example, too many files). */
  batchProblem: string | null;
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function precheckFiles(files: readonly File[], limits: LimitsResponse): PrecheckResult {
  if (files.length > limits.maxFiles) {
    return {
      accepted: [],
      problems: [],
      batchProblem: `You can upload up to ${limits.maxFiles} files at once. You selected ${files.length}. Remove some and try again.`,
    };
  }

  const maxBytes = limits.maxFileSizeMb * 1024 * 1024;
  const accepted: File[] = [];
  const problems: FileProblem[] = [];

  for (const file of files) {
    const ext = extensionOf(file.name);
    const format = EXTENSION_TO_FORMAT[ext];
    if (!limits.allowedExtensions.includes(ext) || format === undefined) {
      problems.push({ fileName: file.name, reason: 'Unsupported file type. Use PDF, TXT or CSV.' });
    } else if (format === 'image') {
      problems.push({ fileName: file.name, reason: 'Images cannot be analysed yet (OCR is not included in this build).' });
    } else if (file.size === 0) {
      problems.push({ fileName: file.name, reason: 'The file is empty.' });
    } else if (file.size > maxBytes) {
      problems.push({
        fileName: file.name,
        reason: `The file is ${formatBytes(file.size)}. The limit is ${limits.maxFileSizeMb} MB per file.`,
      });
    } else {
      accepted.push(file);
    }
  }

  return { accepted, problems, batchProblem: null };
}
