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

/**
 * GET /api/limits: the runtime limits the server enforces. The client reads these instead of the
 * shared DEFAULT_LIMITS, because MAX_FILES and MAX_FILE_SIZE_MB come from the environment.
 */
export const LimitsResponseSchema = z.object({
  maxFiles: z.number().int().positive(),
  maxFileSizeMb: z.number().positive(),
  allowedExtensions: z.array(z.string()).min(1),
  maxDocumentsPerAnalysis: z.number().int().positive(),
  minInstructionChars: z.number().int().nonnegative(),
  maxInstructionChars: z.number().int().positive(),
});
export type LimitsResponse = z.infer<typeof LimitsResponseSchema>;
