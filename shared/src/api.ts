import { z } from 'zod';

/** Standard error envelope returned by every failing API response. Never includes stack traces. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
