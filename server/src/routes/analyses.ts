import { Router } from 'express';
import {
  AnalysisListResponseSchema,
  AnalysisResultSchema,
  DocumentIdSchema,
  ExportQuerySchema,
  createAnalysisRequestSchema,
  type AnalysisResult,
} from '@mdw/shared';
import { AppError } from '../lib/errors.js';
import type { AnalysesRepo } from '../db/repositories/analysesRepo.js';
import type { DocumentsRepo } from '../db/repositories/documentsRepo.js';
import type { AnalysisService } from '../analysis/analysisService.js';
import { exportFileName, toMarkdown, type DocumentLabel } from '../analysis/formatters.js';

export interface AnalysesRouteDeps {
  analyses: AnalysesRepo;
  documents: Pick<DocumentsRepo, 'getById'>;
  service: AnalysisService;
  /** MAX_FILES: the most documents one analysis may use. */
  maxDocuments: number;
}

const LIST_LIMIT = 50;

function parseId(raw: unknown): string {
  const parsed = DocumentIdSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, 'INVALID_ID', 'Analysis id must be a UUID.');
  return parsed.data;
}

export function createAnalysesRouter(deps: AnalysesRouteDeps): Router {
  const { analyses, documents, service } = deps;
  const router = Router();
  const requestSchema = createAnalysisRequestSchema(deps.maxDocuments);

  const findOr404 = (id: string): AnalysisResult => {
    const result = analyses.getFullAnalysis(id);
    if (!result) throw new AppError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found.');
    return result;
  };

  // POST /api/analyses: runs the analysis synchronously and returns the finished result. A failed run
  // still returns 200 with status "failed" and an errorMessage; the analysis record exists either way.
  // Production would make this a job with status polling or SSE (see README).
  router.post('/', async (req, res) => {
    const request = requestSchema.parse(req.body);
    const result = await service.run(request);
    res.json(AnalysisResultSchema.parse(result));
  });

  // GET /api/analyses: most recent first. Summary rows only.
  router.get('/', (_req, res) => {
    res.json(AnalysisListResponseSchema.parse({ analyses: analyses.list(LIST_LIMIT) }));
  });

  // GET /api/analyses/:id: the full result, rebuilt from the normalised tables.
  router.get('/:id', (req, res) => {
    res.json(AnalysisResultSchema.parse(findOr404(parseId(req.params.id))));
  });

  // GET /api/analyses/:id/export?format=markdown|json: copy and download friendly output.
  router.get('/:id/export', (req, res) => {
    const id = parseId(req.params.id);
    const { format } = ExportQuerySchema.parse(req.query);
    const result = findOr404(id);

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(result, 'json')}"`);
      res.type('application/json; charset=utf-8').send(JSON.stringify(result, null, 2));
      return;
    }

    const documentsById = new Map<string, DocumentLabel>();
    for (const documentId of result.documentIds) {
      const record = documents.getById(documentId);
      if (record) documentsById.set(documentId, { originalName: record.originalName });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(result, 'markdown')}"`);
    res.type('text/markdown; charset=utf-8').send(toMarkdown(result, documentsById));
  });

  return router;
}
