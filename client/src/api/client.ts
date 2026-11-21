import { ApiErrorSchema, HealthResponseSchema, type HealthResponse } from '@mdw/shared';

/** Thin fetch wrapper. All responses are validated against shared zod schemas at the boundary. */
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  const json: unknown = await res.json();

  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(json);
    throw new Error(err.success ? err.data.error.message : `Request failed (${res.status})`);
  }

  return HealthResponseSchema.parse(json);
}
