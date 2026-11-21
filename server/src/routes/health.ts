import { Router } from 'express';
import { HealthResponseSchema, type HealthResponse } from '@mdw/shared';

const SERVICE_NAME = 'multi-doc-workbench-server';

export function buildHealth(): HealthResponse {
  // Validate our own output against the shared contract so drift is caught early.
  return HealthResponseSchema.parse({
    status: 'ok',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json(buildHealth());
});
