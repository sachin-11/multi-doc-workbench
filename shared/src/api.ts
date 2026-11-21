import { z } from 'zod';

/** Standard error envelope returned by every failing API response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
