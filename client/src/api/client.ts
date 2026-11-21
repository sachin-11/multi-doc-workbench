import { z } from 'zod';
import {
  ApiErrorSchema,
  AnalysisResultSchema,
  DocumentDetailSchema,
  DocumentListResponseSchema,
  HealthResponseSchema,
  LimitsResponseSchema,
  UploadResponseSchema,
  type AnalysisResult,
  type DocumentDetail,
  type DocumentMeta,
  type ExportFormat,
  type HealthResponse,
  type LimitsResponse,
  type UploadResponse,
} from '@mdw/shared';

/** Every failed call becomes this error, with the server's code and message when it sent one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const NETWORK_MESSAGE = 'Could not reach the server. Check that it is running and try again.';

/** Sends a request and returns parsed JSON, or undefined for 204. Throws ApiRequestError on any failure. */
async function send(path: string, init?: RequestInit): Promise<{ status: number; body: unknown; text: string }> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    }
    throw new ApiRequestError(res.status, 'HTTP_ERROR', `The server returned an error (HTTP ${res.status}).`);
  }
  return { status: res.status, body, text };
}

/** Validates a successful JSON body against a shared schema. A mismatch is an error, never a crash. */
async function getJson<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
  const { body } = await send(path, init);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError(0, 'INVALID_RESPONSE', 'The server response was not in the expected format.');
  }
  return parsed.data;
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson(HealthResponseSchema, '/api/health');
}

export function fetchLimits(): Promise<LimitsResponse> {
  return getJson(LimitsResponseSchema, '/api/limits');
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const data = await getJson(DocumentListResponseSchema, '/api/documents');
  return data.documents;
}

export function getDocumentDetail(id: string): Promise<DocumentDetail> {
  return getJson(DocumentDetailSchema, `/api/documents/${encodeURIComponent(id)}`);
}

/** Uploads files in one multipart request. The server validates each file and reports rejects. */
export function uploadDocuments(files: readonly File[]): Promise<UploadResponse> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  return getJson(UploadResponseSchema, '/api/documents', { method: 'POST', body: form });
}

export async function deleteDocument(id: string): Promise<void> {
  await send(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function runAnalysis(documentIds: readonly string[], instruction: string): Promise<AnalysisResult> {
  return getJson(AnalysisResultSchema, '/api/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentIds, instruction }),
  });
}

/** Returns the server-generated export as text (markdown or JSON). The server is the single source for copy. */
export async function exportAnalysis(id: string, format: ExportFormat): Promise<string> {
  const { text } = await send(`/api/analyses/${encodeURIComponent(id)}/export?format=${format}`);
  return text;
}
