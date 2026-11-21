# M6 — Analysis engine (per-doc extraction, then cross-doc comparison)

**Status:** Done

## Goal
Run the user's analysis prompt in two stages without ever merging documents into one unstructured prompt, and return a typed `AnalysisResult` where every finding cites its documents.

## Flow
1. **Resolve documents.** Only `processed` documents with stored text are used. Others (failed, unsupported, still processing, unknown ids) are skipped with a warning. If none are usable, the request returns `409 NO_USABLE_DOCUMENTS` with the list of problems, and no analysis row is created.
2. **Stage A, per document (independent).** Each chunk gets its own prompt (`buildPerDocumentExtractionPrompt`). Documents run in parallel (concurrency 3), chunks run in order within a document. Chunk facts are merged (`mergeChunkFacts`), given ids by the server, tagged with `documentId`, and checked against that document's full stored text (`verifyFacts`). A failing chunk or document becomes a warning and the run continues.
3. **Stage B, cross-document (collective).** The prompt carries only the structured facts, grouped by `documentId`. No raw text. Output is validated with `CrossDocumentAnalysisOutputSchema`. With fewer than two documents that produced facts, the run is in single-document mode: only the summary is kept, with a warning.
4. **Guards.** `validateProvenance` (known documents and facts only), `enforceFactOwnership` (a factId must belong to the cited document), `attachSnippetsFromFacts` (fills the quote from the fact when the model left it out). Findings with no valid source are dropped, with a warning.
5. **Persist once.** `analysesRepo.persistRun` writes facts, findings with their sources, summary, comparison table, warnings and final status in one transaction.
6. **Failure.** A fatal error (no document extracted, the cross-document call fails, or the total time budget runs out) sets status `failed` with a safe message. Facts from stage A are still saved.

## Endpoints
- `POST /api/analyses` body `{ documentIds, instruction }` → runs synchronously → `AnalysisResult` (200, also for `failed` runs; check `status`)
- `GET /api/analyses` → most recent 50, summaries only
- `GET /api/analyses/:id` → full `AnalysisResult`
- `GET /api/analyses/:id/export?format=markdown|json` → download (`Content-Disposition: attachment`)

## Deliverables
- [x] Stage 1 extractor per document (`server/src/analysis/analysisService.ts`)
- [x] Stage 2 comparer over facts (same file, `interpret`)
- [x] Analysis result saved to `analyses` / `analysis_documents` / `extracted_facts` / `findings` / `finding_sources`
- [x] Test: every finding has non-empty `sources` that reference real document IDs (`server/src/analysis/analysis.test.ts`)
- [x] Markdown export with per-finding `[Source: …]` and separate fact and interpretation sections (`server/src/analysis/formatters.ts`)

## Acceptance
- [x] Two-document run with the MOCK provider returns discrepancy (revenue, name), missing information (licence), and comparison rows, each citing documents.
- [x] A failed document is skipped with a warning and the run completes.
- [x] Removing a document changes the result: a single-document run produces no discrepancies (covered by the failed-document test).
- [ ] Three-document prompt run: not tested with a third document yet. The code path is the same, but it is not covered by a test.

## Files
- `shared/src/analysis.ts` (`warnings`, `AnalysisSummary`, list and export schemas)
- `server/src/analysis/analysisService.ts`, `server/src/analysis/formatters.ts`, `server/src/analysis/analysis.test.ts`
- `server/src/routes/analyses.ts`, `server/src/app.ts`, `server/src/index.ts`, `server/src/testing/testApp.ts`
- `server/src/llm/guards.ts` (`enforceFactOwnership`, `attachSnippetsFromFacts`)
- `server/src/db/repositories/analysesRepo.ts` (`persistRun`, `list`), `documentsRepo.ts` (`isUsedByAnalysis`), `server/src/db/schema.sql` (`warnings_json`)
- `server/src/lib/errors.ts` and `server/src/middleware/errorHandler.ts` (optional `details` on errors)
- `server/src/config/env.ts` (`ANALYSIS_TIMEOUT_MS`), `.env.example`

## Known issues
- **Schema changed** (`warnings_json` column). Existing dev DBs need `npm run db:reset`.
- **Synchronous POST.** A run can take up to `ANALYSIS_TIMEOUT_MS` (default 120 s) and holds the HTTP request. Production would return a job id and use polling or SSE.
- **The timeout stops new work, not work in flight.** It rejects the request at the deadline and blocks further provider calls. An in-flight call finishes on its own (the provider timeout is 45 s).
- **Chunks within a document run one after another.** Long documents mean many sequential calls.
- **No token budget on the stage B prompt.** Many facts from many documents make a large prompt (carried over from M5).
- **Mock matching is by exact key.** `Applicant` and `Applicant Name` are not compared.
- **Single-document mode still calls the model** for the summary. The model's findings and table are discarded.
- **Documents used by an analysis cannot be deleted** (`409 DOCUMENT_IN_USE`). This is a change to the M3 delete route. Deleting would cascade into `finding_sources` and leave findings with no source.
- **The live OpenAI path has not been run against an endpoint** (carried over from M5). The smoke test used the MOCK provider.
- **Facts from stage A are saved in the final transaction.** A crash mid-run leaves the analysis in `running` with nothing saved. Startup recovery is not implemented.
