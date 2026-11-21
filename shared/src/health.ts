import { z } from 'zod';

/** Response shape of GET /api/health. Shared by server (producer) and client (consumer). */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
