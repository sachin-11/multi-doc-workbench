import { Router } from 'express';
import { DEFAULT_LIMITS, EXTENSION_TO_FORMAT, LimitsResponseSchema } from '@mdw/shared';

export interface LimitsRouteConfig {
  MAX_FILES: number;
  MAX_FILE_SIZE_MB: number;
}

/** GET /api/limits: runtime upload and analysis limits, so the client pre-check matches the server. */
export function createLimitsRouter(config: LimitsRouteConfig): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json(
      LimitsResponseSchema.parse({
        maxFiles: config.MAX_FILES,
        maxFileSizeMb: config.MAX_FILE_SIZE_MB,
        allowedExtensions: Object.keys(EXTENSION_TO_FORMAT),
        maxDocumentsPerAnalysis: config.MAX_FILES,
        minInstructionChars: DEFAULT_LIMITS.minInstructionChars,
        maxInstructionChars: DEFAULT_LIMITS.maxInstructionChars,
      }),
    );
  });
  return router;
}
