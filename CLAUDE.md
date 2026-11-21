# CLAUDE.md — Multi-Document Intelligence Workbench

This file is the persistent memory for this project. Read it fully at the start of every session.

## Session Start Instructions
On every new session, in this order:
1. Read this file (`CLAUDE.md`) fully.
2. Read the **PROGRESS LOG** at the bottom and the **DECISIONS LOG**.
3. Run `git log --oneline` to confirm the last committed state.
4. Find the first unchecked module in the **MODULE PLAN** and read its doc in `docs/modules/`.
5. Continue from that module. Do not re-do finished modules.

## Project Summary
A full-stack app (React + Node.js, TypeScript on both sides). A user uploads multiple documents, gives an analysis instruction (e.g. "compare all docs", "find inconsistencies between application form and supporting docs", "extract key dates, obligations, financial values, missing info", "highlight discrepancies in names, addresses, licence details, revenue"), and receives structured insights derived from those documents.

This is a time-boxed (~60 min) take-home / monitored interview assignment. It must be production-minded but lean. Prefer simple working solutions over perfect ones.

## Full Requirements

### Mandatory tech
- React + Node.js, TypeScript on BOTH frontend and backend.
- Relational DB: SQLite via `better-sqlite3` (zero setup).
- Document parsing: `pdf-parse` (PDF), plain text, `papaparse` (CSV). Image OCR via `tesseract.js` is optional / stretch.
- LLM: OpenAI-compatible provider configured by env vars, with an automatic **MOCK provider** when no `LLM_API_KEY` is set. The app must run without a key.

### Functional requirements
1. Upload multiple documents.
2. Support at least 2 formats (PDF, TXT, CSV; image optional).
3. Extract / ingest content per document.
4. Accept a user-defined analysis prompt.
5. Analyse documents **independently AND collectively**.
6. Output as: comparison table, consolidated summary, discrepancy list, missing-information report, key-value extraction.
7. **Every finding must cite which document(s) support it (provenance).**
8. Copy-output button.
9. Graceful handling of unsupported / unreadable / invalid files.
10. Synthetic sample documents only (no real data).

### Engineering expectations
- Strong TypeScript (shared types, **no `any`**), zod validation.
- Clear frontend / backend separation.
- Modular document-processing pipeline: one parser per format behind one interface.
- Structured AI output: JSON schema validated with zod.
- **Preserve document boundaries. NEVER merge all docs into one unstructured prompt.** Per-document extraction first, then cross-document comparison on the structured extractions.
- **Clearly separate extracted facts vs AI-generated interpretation** in the data model and in the UI.
- File validation: type, size limit, count limit, filename sanitisation.
- Secure file handling: memory / tmp storage, no path traversal, never execute content.
- Proper error handling.
- Large content handling: chunking / truncation per document, with a visible note.
- At least one meaningful automated test (vitest).
- Small, clear commits.

### Submission needs
Source, setup instructions, `.env.example`, synthetic sample docs, DB schema/seed, README (architecture, assumptions, completed functionality, known limitations, security considerations, productionisation), tests, clean commit history, AI tools disclosure, and which decisions the developer made personally.

## Tech Decisions (and why)
| Area | Choice | Why |
|---|---|---|
| Monorepo | npm workspaces: `shared`, `server`, `client` | One install, shared zod schemas and types, no extra tooling |
| Frontend | Vite + React + TypeScript | Fast dev server, simple proxy to API |
| Backend | Express 5 + TypeScript, `tsx` for dev | Familiar, minimal, easy to read in a review |
| Validation | zod at every boundary (env, HTTP body, LLM output) | Single source of truth via `shared` |
| DB | SQLite via `better-sqlite3` | Zero setup, relational, synchronous API is simple |
| Parsing | `pdf-parse`, native text, `papaparse` | Covers required formats with small dependencies |
| LLM | OpenAI-compatible HTTP client + MOCK provider | Works with any compatible endpoint; runs with no key |
| Tests | vitest (+ supertest for HTTP) | Same toolchain as Vite; fast |
| Shared package | Compiled to `shared/dist` before server/client use it | Runtime-safe in `node` (no TS import at runtime) |

## Folder Structure
```
multi-doc-workbench/
├── CLAUDE.md              # this file (memory, plan, logs)
├── README.md              # submission README (filled in M10)
├── .env.example           # documented env vars (copy to .env)
├── package.json           # workspaces + root scripts (dev, build, test, typecheck)
├── tsconfig.base.json     # shared strict TS settings
├── docs/modules/          # one doc per module (M01..M10): goal, deliverables, status
├── shared/                # @mdw/shared: zod schemas + TS types used by client & server
│   └── src/               # api.ts, health.ts, (documents.ts, analysis.ts later)
├── server/                # @mdw/server: Express API
│   └── src/
│       ├── index.ts       # entry: load config, start listening
│       ├── app.ts         # createApp(config): middleware + routes (testable)
│       ├── config/        # env.ts: zod-validated env loading
│       ├── lib/           # errors.ts (AppError), small helpers
│       ├── middleware/    # errorHandler.ts (central handler + 404)
│       └── routes/        # health.ts (more routes added in M3+)
├── client/                # @mdw/client: Vite + React
│   └── src/
│       ├── main.tsx       # React entry
│       ├── App.tsx        # top-level page
│       └── api/           # typed fetch wrappers (zod-validated responses)
└── samples/               # synthetic sample documents (M8)
```

## Coding Conventions
- TypeScript `strict` everywhere. **No `any`.** Use `unknown` and narrow with zod.
- zod at every boundary: env vars, HTTP request bodies / responses, LLM output, parsed file content.
- Shared contracts live in `shared/`; never duplicate a type on both sides.
- Small modules, one responsibility each. Parsers, providers, and routes are separate files.
- Errors: throw `AppError(status, code, message)` for expected failures; the central handler formats the `{ error: { code, message } }` envelope. Never leak stack traces.
- Relative imports in `server/` use `.js` extensions (NodeNext).
- Commit after each module with a conventional commit message, e.g. `feat(server): add upload endpoint` or `chore: project scaffold and CLAUDE.md`. Every commit message ends with the `Co-Authored-By` trailer the session specifies.
- Do not commit `.env`, uploads, or SQLite files (see `.gitignore`).
- Run `npm run typecheck` and `npm test` before every commit.

## Core Design Rule (most important)
```
per-document extraction  ->  structured facts (each with documentId + location)
                         ->  cross-document analysis (operates on facts only)
                         ->  findings, each with sources: documentId[]
```
- **Facts** (what a document literally says, with the source document and location) and **interpretation** (AI-generated comparison, discrepancy, summary) are separate types, separate DB tables or columns, and separate UI sections with distinct labels.
- Every finding has `sources: documentId[]` (non-empty). A finding without provenance is invalid and must be rejected by zod.
- Long documents are chunked per document; the chunking/truncation is recorded and shown to the user.

## MODULE PLAN
Rule for every module: after completing it, (1) tick its checkbox here, (2) update its file in `docs/modules/`, (3) append to the PROGRESS LOG and DECISIONS LOG, (4) run `npm run typecheck` and `npm test`, (5) commit.

- [x] **M1** Project setup + CLAUDE.md — [doc](docs/modules/M01-project-setup.md)
- [x] **M2** Shared types/schemas + SQLite schema (documents, analyses, findings) — [doc](docs/modules/M02-shared-schemas-and-db.md)
- [x] **M3** Upload API + file validation + secure handling — [doc](docs/modules/M03-upload-api.md)
- [x] **M4** Document processing pipeline (parser interface, PDF/TXT/CSV, chunking, error states) — [doc](docs/modules/M04-processing-pipeline.md)
- [x] **M5** LLM provider abstraction (real + mock) + structured output with zod — [doc](docs/modules/M05-llm-provider.md)
- [x] **M6** Analysis engine (per-doc extraction, then cross-doc comparison with provenance) — [doc](docs/modules/M06-analysis-engine.md)
- [x] **M7** Frontend: upload UI, prompt input, results views (table, summary, discrepancies, missing info, key-values), source badges, copy button, error states — [doc](docs/modules/M07-frontend.md)
- [x] **M8** Synthetic sample documents (application form PDF, supporting TXT, financials CSV with deliberate mismatches) — [doc](docs/modules/M08-sample-documents.md)
- [ ] **M9** Tests (pipeline + analysis provenance) — [doc](docs/modules/M09-tests.md)
- [ ] **M10** README, AI disclosure, final cleanup — [doc](docs/modules/M10-readme-and-disclosure.md)

## Time Budget
Total ~60 minutes for the whole assignment. Prefer the simplest thing that meets the requirement. If a module runs long, cut scope (e.g. skip OCR, keep a single analysis prompt path) and write it in KNOWN ISSUES rather than stalling.

## PROGRESS LOG
Newest entries at the bottom. Each entry: date/time, module, what was done, files touched, known issues, next step.

### 2026-11-21 14:55 (local) — M1 Project setup + CLAUDE.md
- **Done:** npm workspaces monorepo (`shared`, `server`, `client`, `samples`). Root scripts `dev` (server + client via `concurrently`), `build`, `test`, `typecheck`. Express server with `/api/health`, CORS for Vite origin, zod-validated env loading, central error handler + JSON 404 for unknown `/api` routes. Vite React page that calls `/api/health` through the dev proxy. `.gitignore`, `.env.example`, strict `tsconfig`. Vitest with 3 passing tests (health contract, CORS, 404 envelope). Created this file, README skeleton, and one doc per module.
- **Verified:** `npm install` OK; `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 3/3 passing; `npm run dev` starts both servers; `/api/health` responds directly on :4000 and through the Vite proxy on :5173; unknown API route returns the 404 envelope; client page returns HTTP 200.
- **Files touched:** root `package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `CLAUDE.md`, `README.md`, `docs/modules/*`, `samples/README.md`, `shared/*`, `server/*` (incl. `vitest.config.ts`), `client/*`.
- **Known issues:**
  - `npm run dev` depends on `predev` building `shared`; running `tsx`/vitest directly without building `shared` first will fail to resolve `@mdw/shared`.
  - Added `CLIENT_ORIGIN` env var (not in the original list) so CORS origin is configurable.
  - Vitest originally picked up compiled `dist/*.test.js`; fixed with `server/vitest.config.ts` excluding `dist/`.
- **Next step:** M2 — shared Zod schemas for documents, analyses, findings (facts vs interpretation kept separate) and the `better-sqlite3` schema + seed.

### 2026-11-21 15:10 (local) — M2 Shared schemas + SQLite data layer
- **Done:** Zod schemas and inferred types in `shared/` for documents, facts (`ExtractedFact`), interpretation (`Finding` with non-empty `sources`, `isInterpretation: true`, `ComparisonTable`, `AnalysisRequest`, `AnalysisResult` with separate `perDocumentFacts` and findings fields). Constants (supported formats, MIME and extension maps, default limits). LLM output schemas (`PerDocumentExtractionOutput`, `CrossDocumentAnalysisOutput`) plus `findUnknownSourceDocumentIds` helper. SQLite schema (`CREATE TABLE IF NOT EXISTS`, CHECK constraints, FKs, indexes) applied on startup. Repositories `documentsRepo` and `analysesRepo` (prepared statements, transactions, zod validation on write and read). `DB_PATH` env (default `./data/app.db`), `npm run db:reset`. One vitest file with 3 tests (provenance round trip, finding without sources rejected with rollback, not-found and ordering).
- **Verified:** `npm run typecheck` exit 0; `npm test` 6/6 passing (3 M1 + 3 M2); `npm run build` exit 0 and `dist/db/schema.sql` copied; real file DB created with FK on and WAL on; `db:reset` removes DB file; server starts and logs the DB path.
- **Files touched:** `shared/src/{api,index,documents,facts,analysis,constants,llmOutput}.ts`, `server/src/config/env.ts`, `server/src/index.ts`, `server/src/db/{schema.sql,client.ts,reset.ts,repositories/documentsRepo.ts,repositories/analysesRepo.ts,repositories/repositories.test.ts}`, `server/scripts/copy-schema.mjs`, `server/package.json`, `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `docs/modules/M02-shared-schemas-and-db.md`.
- **Known issues:**
  - No seed script yet (optional in M02 doc). `db:reset` only deletes the DB.
  - "Every finding has sources" is enforced in zod at the repository layer, not by a SQL trigger. A raw SQL insert could still create a finding with no `finding_sources` row.
  - `findUnknownSourceDocumentIds` exists, but nothing calls it yet. M6 must call it before saving LLM output.
  - `finding_sources.document_id` is not checked to belong to the analysis. The FK only checks that the document exists.
  - `findings.created_at` is stored but not part of the `Finding` type.
  - `better-sqlite3` native binary: `node_modules/@mdw/*` links were broken (Git Bash `/c/...` targets) and had to be recreated with a root `npm install`. Run `npm install` at the root if `@mdw/*` imports fail.
  - Schema changes need `db:reset` until a migration tool is added.
- **Next step:** M3 — upload API (`POST /api/documents`), file validation (type, size, count from config), filename sanitisation, memory/tmp handling. Use `openDatabase(config.DB_PATH)` and `createDocumentsRepo` from `server/src/db/`.

### 2026-11-21 15:30 (local) — M3 Upload API + validation + secure handling
- **Done:** `POST /api/documents` (multipart, field `files`, multer memory storage only). Each file goes through a pure validation pipeline: extension allowlist, declared MIME matches extension, empty file, magic bytes (PDF `%PDF-`, PNG and JPEG signatures), TXT/CSV valid UTF-8 with no NUL bytes, filename sanitisation (path segments, control chars, unsafe symbols, length cap, no leading dots). Partial success: valid files are stored and queued, invalid ones are stored with status `unsupported` or `failed` and returned in `rejected` with a code and reason. `GET /api/documents` (metadata only), `GET /api/documents/:id` (UUID validated), `DELETE /api/documents/:id` (DB row and buffer). In-memory buffer store with TTL. `enqueueProcessing(id)` placeholder hook for M4. Central error handler maps multer, zod and body-parser errors to the ApiError envelope. `helmet` added. Upload limits come from config (`MAX_FILES`, `MAX_FILE_SIZE_MB` default 10, `BUFFER_TTL_MINUTES`).
- **Verified:** `npm run typecheck` exit 0; `npm test` 28/28 passing (5 files). Covered: valid PDF, fake PDF, empty file, `.exe`, path traversal (`../../etc/passwd.txt` becomes `passwd.txt`), mixed valid and invalid upload returns 200 with 1 accepted and 1 rejected, 413 on too many files, 415 on non-multipart, 400 on no files, id validation, 404, delete, buffer TTL.
- **Not verified:** a manual curl smoke test against a running server. The attempt was blocked by the permission classifier. Supertest runs the same Express app over HTTP, so coverage is equivalent for routes, but a live check is still worth doing.
- **Files touched:** `shared/src/{upload,documents,constants,index}.ts`, `server/src/{app,index}.ts`, `server/src/config/env.ts`, `server/src/middleware/errorHandler.ts`, `server/src/routes/documents.ts`, `server/src/upload/validation.ts` (+ test), `server/src/storage/bufferStore.ts` (+ test), `server/src/processing/index.ts`, `server/src/lib/logger.ts`, `server/src/testing/testApp.ts`, `server/src/app.test.ts`, `server/src/db/schema.sql`, `server/src/db/repositories/documentsRepo.ts`, `server/src/routes/documents.test.ts`, `server/package.json`, `package-lock.json`, `.env.example`, `docs/modules/M03-upload-api.md`.
- **Known issues:**
  - **Buffers are in memory only.** After a restart, a `uploaded` document row has no bytes. M4 must mark such documents `failed` when the buffer is missing.
  - Size and count limits are enforced by multer. An oversize file or too many files returns 413 for the whole request, not per file. This is the intended multer behaviour and it matches the 413 requirement.
  - `documents.format` is now nullable, so the schema changed from M2. Existing dev DBs need `npm run db:reset`.
  - Config lives in `server/src/config/env.ts` (as CLAUDE.md folder structure says), not `server/src/config.ts` as in the M3 brief.
  - The filename sanitiser keeps ASCII only. Non-ASCII letters become `_`. `originalName` keeps the cleaned display name.
  - `application/vnd.ms-excel` is accepted for `.csv` only (Windows browsers send it for CSV). Sent with `.txt` or `.pdf`, it fails the MIME check.
  - No authentication, no rate limiting. Both are out of scope for the assignment.
- **Next step:** M4 — parser interface, PDF/TXT/CSV parsing, chunking and truncation (`wasTruncated`, `charCount`), status transitions (`uploaded` → `processing` → `processed`/`failed`), and the missing-buffer case above. Wire it into `server/src/processing/index.ts`.

### 2026-11-21 16:00 (local) — M4 Document processing pipeline
- **Done:** Parser interface and registry (`DocumentParser`, `UnsupportedFormatError`, `DocumentParseError`). Parsers: TXT (strict UTF-8), PDF (pdf-parse v2, page count, scanned or empty PDF gives a clear error), CSV (papaparse, `Columns:` line and `Row n: column=value; ...` text, capped at 500 rows with a warning). Pure text functions: normalise, per-document truncation (`MAX_CHARS_PER_DOCUMENT`, sets `wasTruncated` and a warning), chunking (4000 chars, 200 overlap, offsets recorded). Orchestrator: status `processing` → `processed` / `failed` / `unsupported`, 20 s timeout, safe error messages, raw bytes freed after processing, `getParsedDocument` recomputes chunks from stored text. In-process queue with concurrency 2. `GET /api/documents/:id` returns detail (preview only). `GET /api/documents/:id/text` returns full text, or 409 if not processed. Missing-buffer case (M3 known issue) now becomes `failed` with "upload it again".
- **Verified:** `npm run typecheck` exit 0. `npm test` 55/55 passing (8 files), including a batch test (one corrupt PDF plus one TXT: the TXT is processed, the PDF fails). Covered: TXT normalisation, CSV labelled text and row count, 500-row cap, chunk offsets and full coverage, truncation flag and warning, valid PDF fixture (generated in code), corrupted PDF → `failed` with readable message while the server keeps answering, image → `unsupported` and 409 for text, timeout, missing buffer, generic message for unexpected errors (no internal details).
- **Files touched:** `shared/src/{processing,constants,index}.ts`, `server/src/processing/{index,text,finalize,queue}.ts`, `server/src/processing/parsers/{types,decode,txtParser,pdfParser,csvParser,registry}.ts`, tests in `server/src/processing/{text.test,processor.test}.ts` and `server/src/processing/parsers/parsers.test.ts`, `server/src/testing/{fixtures,testApp}.ts`, `server/src/routes/{documents,documents.test}.ts`, `server/src/app.ts`, `server/src/index.ts`, `server/src/config/env.ts`, `server/src/db/schema.sql`, `server/src/db/repositories/documentsRepo.ts`, `server/package.json`, `package-lock.json`, `.env.example`, `docs/modules/M04-processing-pipeline.md`.
- **Known issues:**
  - **No OCR.** Scanned PDFs fail with a clear message. Images are `unsupported`. Image OCR (`tesseract.js`) is stretch and was not started.
  - **Queue is in memory.** Jobs are lost on restart. A document left in `processing` after a crash stays that way. Production would use BullMQ or SQS, and a startup sweep for stuck documents.
  - **Timeout cannot cancel CPU work.** The parse keeps running in the background, but the document is marked `failed` and its bytes are freed. A worker thread would allow real cancellation.
  - **Chunk offsets are on the stored text.** Text is normalised and truncated before chunking, so offsets point into the normalised text, not the raw upload. Provenance snippets must use the stored text.
  - **`charCount` is the stored (truncated) length.** The original length appears only in the truncation warning.
  - **PDF tables and layout** are flattened to text. Columns and reading order can be lost.
  - **Schema changed** (`parse_info_json` column). Existing dev DBs need `npm run db:reset`.
- **Next step:** M5 — LLM provider abstraction (OpenAI-compatible HTTP client and MOCK provider), with zod-validated structured output (`PerDocumentExtractionOutput`, `CrossDocumentAnalysisOutput`) and retry or fallback on invalid output.

### 2026-11-21 16:30 (local) — M5 LLM provider abstraction, mock, structured output, guards
- **Done:** `LLMProvider` interface with `generateStructured<T>` (zod-validated, typed errors). OpenAI-compatible provider on the official `openai` SDK, behind a narrow transport interface: JSON mode, schema hint from `z.toJSONSchema`, one repair retry that sends the zod issues back, 45 s timeout, one retry with backoff on network, 429 and 5xx. Logs token counts and timings only. Offline MOCK provider: rule-based extraction (labelled lines, CSV pairs, currency, email, ISO dates) with exact snippets, and cross-doc analysis by key (discrepancies, comparisons, missing info, table, summary) with real documentIds. Factory `getLLMProvider(config)`. Prompt builders: one prompt per chunk for extraction, facts-only prompt for cross-doc, `mergeChunkFacts`, injection guard, delimiter neutralising. Post-validation guards: `validateProvenance`, `verifyFact` / `verifyFacts`.
- **Verified:** `npm run typecheck` exit 0. `npm test` 72/72 passing (9 files, 17 new in `server/src/llm/llm.test.ts`). Covered: mock extraction snippets exist in text, two documents with different revenue give one discrepancy citing both documentIds (through the real prompt), a missing field is cited in both documents, `validateProvenance` removes a fake documentId, unknown factIds are nulled, snippet verification caps confidence, OpenAI repair (invalid then valid) succeeds, both-invalid throws `LLMOutputValidationError`, 429 retry succeeds, 400 is not retried and leaks no body, factory returns mock without a key.
- **Files touched:** `server/src/llm/{types,openaiProvider,mockProvider,mockExtraction,mockAnalysis,prompts,guards,index,llm.test}.ts`, `server/src/index.ts`, `server/package.json`, `package-lock.json`, `docs/modules/M05-llm-provider.md`.
- **Known issues:**
  - **The OpenAI path has not been run against a live endpoint.** It is tested with a fake transport only. The SDK adapter (`createOpenAISdkClient`) is type-checked but not exercised.
  - **Mock extraction is heuristic.** It only sees labelled lines, CSV pairs, currency, email and ISO dates. Free-text facts (names in sentences, addresses without labels) are not found. The mock ignores the user instruction.
  - **Mock finds facts by label text.** Two documents that use different labels for the same field (`Applicant` vs `Applicant Name`) will not be compared. M6 needs normalised key matching or the LLM path.
  - **Repair retry sends the model's own bad reply back**, which may contain document text. This stays with the same provider, but it lengthens the prompt.
  - **`validateProvenance` checks document ids, not that a fact belongs to the cited document.** A fact id from document B cited under document A passes. M6 should map factId → documentId.
  - **Guards are not called yet.** They must be wired into the M6 flow.
  - **Token budget is not enforced.** Chunks are capped by the parser (4000 chars), but a long instruction or many facts can still make the cross-doc prompt large. No limit on total facts sent.
- **Next step:** M6 — analysis engine. Persist analysis, run per-document extraction per chunk (`mergeChunkFacts`), save facts (`saveFacts`), run the cross-doc prompt on facts only, apply `validateProvenance` and `verifyFacts`, then save findings (`saveFindings`). Set `AnalysisResult.provider` from `provider.name`.

### 2026-11-21 15:45 (local) — M6 Two-stage analysis engine, provenance, export
- **Done:** `runAnalysis` service: resolve documents (problem documents skipped with a warning, 409 when none are usable), Stage A per document and per chunk (documents in parallel, concurrency 3, failures become warnings), Stage B cross-document on facts only, guards (`validateProvenance`, new `enforceFactOwnership`, `attachSnippetsFromFacts`), and one transactional `persistRun` (facts, findings with sources, summary, table, warnings, status). Fatal errors mark the run `failed` and keep the facts already extracted. Total budget `ANALYSIS_TIMEOUT_MS` (120 s). Stage timings are logged, not returned. Routes: `POST /api/analyses` (sync), `GET /api/analyses` (list), `GET /api/analyses/:id`, `GET /api/analyses/:id/export?format=markdown|json`. `toMarkdown` is a pure formatter with per-finding `[Source: …]`, separate interpretation and fact sections, and warnings. `AnalysisResult` gained `warnings`. Deleting a document used by an analysis is now refused (409).
- **Verified:** `npm run typecheck` exit 0. `npm test` in server: 85/85 passing across 10 files, including 13 new analysis tests (two-document end-to-end with provenance checks, failed document → completes with warning, one failing extraction doc, cross-doc failure keeps facts, timeout, no usable docs → 409, validation, markdown and JSON export, list and 404, delete guard, fact-ownership guard, markdown escaping). Live smoke test: started the server on `DB_PATH=:memory:`, uploaded two text files, ran the analysis over HTTP, and exported markdown. Result: completed in about 9 ms, correct discrepancies and missing licence, sources on every finding.
- **Files touched:** `shared/src/analysis.ts`, `server/src/analysis/{analysisService,formatters,analysis.test}.ts`, `server/src/routes/analyses.ts`, `server/src/app.ts`, `server/src/index.ts`, `server/src/testing/testApp.ts`, `server/src/llm/guards.ts`, `server/src/db/repositories/{analysesRepo,documentsRepo}.ts`, `server/src/db/schema.sql`, `server/src/routes/documents.ts`, `server/src/lib/errors.ts`, `server/src/middleware/errorHandler.ts`, `server/src/config/env.ts`, `.env.example`, `docs/modules/M06-analysis-engine.md`.
- **Known issues:**
  - **Schema changed** (`warnings_json` on `analyses`). Existing dev DBs need `npm run db:reset`.
  - **Sync POST** holds the request for up to 120 s. Production would use a job id with polling or SSE. The timeout blocks new provider calls but does not cancel one in flight (45 s provider timeout).
  - **Chunks within a document run sequentially.** No token budget on the stage B prompt.
  - **Mock matching is by exact key.** Label variants are not compared (carried over from M5).
  - **Live OpenAI path not run** against an endpoint (carried over from M5).
  - **Intermittent test crash:** one full-suite run showed a worker exit (`0xC0000409`) in `routes/documents.test.ts` (PDF parse). Two reruns passed. Not reproduced, not investigated further.
  - The spec's sample text was comma-separated on one line. The MOCK reads one `Label: value` per line, so the test fixtures put one field per line.
  - A run that crashes mid-way stays `running`. No startup recovery.
### 2026-11-21 16:05 (local) — M7 Frontend: upload, analysis, provenance-aware results
- **Done:** Single-page React + TypeScript UI in three sections. Documents: drag-and-drop and picker, client pre-check with friendly messages, server rejects shown per file, list with format, size, status chip, warnings, errors, delete, and per-document include checkboxes (processed only, all included by default). Polling every 1.5 s only while a document is `uploaded` or `processing`. Instruction: textarea with counter (5 to 2000), four example chips, Analyse button disabled until a processed document is selected and the instruction is valid, stage text while running. Results: five tabs (Summary, Comparison, Discrepancies, Missing information, Extracted facts), provider badge, warnings banner, copy as Markdown, copy JSON, download `.md` (all from the export endpoint, with a textarea fallback if the clipboard is blocked). Every finding shows one source badge per document. Hover or focus shows the snippet, and a click switches to Extracted facts, opens that document and highlights the fact. Facts use a neutral "Fact" tag. AI interpretation uses an indigo accent and an "AI" tag.
- **Backend gap (documented, small):** `GET /api/limits` added (`server/src/routes/limits.ts`, `LimitsResponseSchema` in shared). The shared `DEFAULT_LIMITS.maxFileSizeMb` is 5, but the server default is 10 MB, so the client cannot use the constant for its pre-check.
- **Verified:** `npm run typecheck` exit 0. `npm test` exit 0: server 86/86 (11 files, including the new limits test), client 2/2 (`FindingCard` with two sources shows both badges and the AI tag; `App` happy path with fetch fixtures: upload, polling to Ready, example chip, analyse, sourced discrepancy card, copy shows toast, source click lands on facts tab). `npm run build -w @mdw/client` exit 0. Live dev stack through the Vite proxy: page 200, `/api/limits`, multipart upload, analysis `completed`, delete of a used document 409.
- **Files touched:** `client/src/api/client.ts`, `client/src/lib/precheck.ts`, `client/src/hooks/{useDocuments,useAnalysis}.ts`, `client/src/components/*` (11 files), `client/src/App.tsx`, `client/src/styles.css`, `client/src/App.test.tsx`, `client/src/components/FindingCard.test.tsx`, `client/vitest.config.ts`, `client/package.json`, `server/src/routes/limits.ts` (+ test), `server/src/app.ts`, `shared/src/api.ts`, `docs/modules/M07-frontend.md`, root `package.json` and `package-lock.json`.
- **Dependency note:** jsdom was installed at the root as well as in the client workspace. Vitest runs from the root `node_modules`, and it could not resolve `jsdom` from `client/node_modules` alone.
- **Known issues:**
  - **Not clicked in a real browser.** No browser tool was available. Layout, focus rings, the hover popover, and the phone-width check (no horizontal scroll) are unverified. The jsdom test covers behaviour, not appearance.
  - **Warnings need one extra request per processed document** (`GET /api/documents/:id`), since the list omits them.
  - **Stage text is a timed estimate.** The analysis is a single synchronous request, so the server reports no stages.
  - **Polling only.** No push updates, so a document that finishes between polls shows up within 1.5 s.
  - **No analysis history UI.** The page shows the latest run only.
  - **Dark mode follows the OS setting only.** No toggle.
- **Next step:** M8 — synthetic sample documents: an application form PDF, a supporting TXT, and a financials CSV, with deliberate mismatches (name, address, licence, revenue), placed in `samples/` and described in `samples/README.md`. Check the sample set with the real upload and analysis flow.

### 2026-11-21 16:00 (local) — M8 Synthetic sample documents, expected findings, seed
- **Done:** Fictional loan scenario (Nimbus Agro Foods Pvt Ltd) with fake identifiers. `scripts/generate-samples.ts` builds `application_form.pdf` with pdfkit and writes the TXT, CSV and invalid files. It is idempotent. `scripts/seed.ts` loads the four valid samples through the same validation, repository, buffer and processor services the upload route uses. `samples/EXPECTED_FINDINGS.md` lists every planted item as a checklist. MOCK heuristics were improved so the planted items are found: canonical keys (filler words and aliases), long-form CSV row labels (`revenue_fy2025`), and company suffix normalisation. New tests: `server/src/llm/mockHeuristics.test.ts` and `server/src/analysis/samples.test.ts` (end to end on the committed samples).
- **Verified:** `npm run samples:generate` twice (second run: all `unchanged`). `npm run seed`: four `processed`. The PDF text contains `FSL-TEST-0042`. Live HTTP analysis with the spec instruction on the four docs: `completed`, provider `mock`. Four discrepancies: applicant (Mehta/Mehra, high), address (Sector 21/12, medium), licence expiry (2027/2026, medium), revenue_fy2025 (three values, three sources, high). The company name variant is not flagged. Co-director and KYC revenue are reported missing. Live upload of the four invalid files: 0 accepted, 4 rejected (`SIGNATURE_MISMATCH`, `EMPTY_FILE`, `UNSUPPORTED_EXTENSION` x2). `npm run typecheck` exit 0. `npm test`: server 115/115, client 2/2.
- **Detected by the MOCK:** D1 to D4 (discrepancies), C1 to C3 (consistent items, not flagged), M1 to M5 (missing information), O1 (EMI captured as a fact only).
- **Needs a real LLM (documented, not asserted):** L1 licence probably expired (the mock does not compare dates with today), L2 revenue is "provisional" (prose), L3 EMI impact on the request (interpretation).
- **Files touched:** `scripts/{generate-samples.ts,seed.ts,package.json,tsconfig.json}`, root `package.json` (`samples:generate`, `seed`, typecheck of scripts) and `package-lock.json` (pdfkit, @types/pdfkit), `samples/*` (generated files, `README.md`, `EXPECTED_FINDINGS.md`), `server/src/llm/{mockExtraction,mockAnalysis,mockHeuristics.test}.ts`, `server/src/analysis/samples.test.ts`, `server/src/llm/llm.test.ts` and `server/src/analysis/analysis.test.ts` (five assertions updated from the old literal keys to canonical keys), `docs/modules/M08-sample-documents.md`, `CLAUDE.md`.
- **Known issues:**
  - The mock's missing-information list is long: it reports a field as missing whenever any document in the run lacks it. The planted items are all in it.
  - The local dev DB was reset with `db:reset` (it predated the M4 schema change and was empty). The live check added four rejected rows (the invalid files) to the local DB. They appear in the document list with their reasons.
  - `scripts/` is a standalone ESM folder (`scripts/package.json`), not an npm workspace. It is typechecked with `tsc -p scripts/tsconfig.json`.
  - Canonical keys use a fixed filler list and alias table. This is not semantic matching, so unlisted label variants will still not match.
- **Next step:** M9 — tests (pipeline + analysis provenance). `samples.test.ts` already covers the sample-set provenance path end to end. M9 should fill the gaps listed in `docs/modules/M09-tests.md`.

## DECISIONS LOG

## DECISIONS LOG
Ownership legend:
- **[Assignment]**: fixed by the assignment brief
- **[Developer]**: chosen personally by the developer (update when confirmed)
- **[AI-suggested]**: proposed by the AI assistant, developer should confirm, change or reject

The AI-disclosure section of the README (M10) is built from this list. Mark each AI-suggested row as accepted, changed, or rejected by the developer.

| # | Date | Decision | Why | Owner |
|---|---|---|---|---|
| D1 | 2026-11-21 | Monorepo with npm workspaces: `shared`, `server`, `client` | Shared zod contracts, single install | [Assignment] (layout) |
| D2 | 2026-11-21 | SQLite via `better-sqlite3` | Zero setup, relational | [Assignment] |
| D3 | 2026-11-21 | Express 5 + `tsx` for dev, Vite for client | Simple, familiar, fast feedback | [AI-suggested] |
| D4 | 2026-11-21 | Shared package compiled to `dist` before server/client use it (`predev`/`build`/`typecheck`/`test` run the shared build first) | Avoids runtime TS import issues in Node and keeps `tsx`/vitest/tsc simple | [AI-suggested] |
| D5 | 2026-11-21 | Env validated with zod; `LLM_API_KEY` empty means MOCK provider | Explicit config, app runs without a key | [AI-suggested] (provider behaviour is required by [Assignment]) |
| D6 | 2026-11-21 | Extra env var `CLIENT_ORIGIN` for CORS | Avoids hard-coding the Vite origin | [AI-suggested] |
| D7 | 2026-11-21 | Central `AppError` + `{ error: { code, message } }` envelope | One error shape for client and tests | [AI-suggested] |
| D8 | 2026-11-21 | Project lives at `sachinProjects/multi-doc-workbench/`, a standalone git repo next to other projects (moved from a nested location) | Keeps unrelated files out of the submission repo | [Developer] (confirmed) |
| D9 | 2026-11-21 | Facts vs interpretation kept separate; every finding has `sources: documentId[]` | Required by [Assignment] (provenance and separation) | [Assignment] |
| D10 | 2026-11-21 | Per-document extraction first, then cross-document analysis; never one merged prompt | Required by [Assignment] | [Assignment] |
| D11 | 2026-11-21 | Facts (`ExtractedFact`) and interpretation (`Finding`) are separate zod types, separate DB tables, and separate `AnalysisResult` fields (`perDocumentFacts` vs `findings` / `comparisonTable` / `summary` / `missingInformation`) | Core design rule: facts are what documents say, findings are AI conclusions | [Assignment] |
| D12 | 2026-11-21 | Provenance in a `finding_sources` table (one row per source document, optional `fact_id` and `snippet`); a finding needs at least one row | Lets one finding cite several documents and link to the exact fact. Enforced by zod in the repository, not by SQL | [AI-suggested] |
| D13 | 2026-11-21 | SQLite via `better-sqlite3` with WAL and `foreign_keys = ON`; schema in `schema.sql` applied on startup with `CREATE TABLE IF NOT EXISTS` (no migration tool) | Zero setup, safe concurrent reads, simple to review. Schema changes use `db:reset` for now | [AI-suggested] (SQLite itself is [Assignment]) |
| D14 | 2026-11-21 | Repositories are factory functions that take the `Db` handle; tests use `:memory:` | No global singleton, isolated tests | [AI-suggested] |
| D15 | 2026-11-21 | Max documents per analysis comes from config (`MAX_FILES`) through `createAnalysisRequestSchema(max)`. `DEFAULT_LIMITS` are only fallbacks and schema bounds | Limits stay configurable without hard-coding them in `shared` | [AI-suggested] |
| D16 | 2026-11-21 | `DB_PATH` resolves relative to the repo root; `:memory:` is allowed | Same path regardless of which workspace runs the command | [AI-suggested] |
| D17 | 2026-11-21 | Multer memory storage only. User file names are never used in filesystem paths. Nothing is written to disk | Removes path traversal and disk-leftover risk. The file name is display data only | [AI-suggested] |
| D18 | 2026-11-21 | Content checks by magic bytes (PDF `%PDF-`, PNG and JPEG signatures) and UTF-8 with no NUL bytes for TXT and CSV, in addition to extension and declared MIME | A renamed or fake file is rejected even when its extension and MIME type look right | [AI-suggested] |
| D19 | 2026-11-21 | Partial-success upload: each file is validated on its own. Valid files are stored and queued. Invalid files are stored with status `unsupported` or `failed` and returned with a code and reason. The request returns 200. Multer count and size limits still return 413 for the whole request | One bad file does not block a batch. The UI can show every file and why it failed | [Assignment] (partial success implied by the upload requirements) and [AI-suggested] (the exact behaviour) |
| D20 | 2026-11-21 | Raw upload bytes are kept in an in-process `Map` with a TTL (`BUFFER_TTL_MINUTES`, default 60). Production would use object storage | Simplest option that keeps bytes out of SQLite and out of the file system. Known limitation: lost on restart | [AI-suggested] |
| D21 | 2026-11-21 | `DocumentMeta.format` is nullable. Rejected files whose type is unknown have no format | A rejected `.exe` has no supported format, but it still needs a DB row so the UI can show it | [AI-suggested] |
| D22 | 2026-11-21 | Config stays in `server/src/config/env.ts`, following the folder structure in this file, not `server/src/config.ts` from the M3 brief | Keeps one config location, as the structure section specifies | [AI-suggested] |
| D23 | 2026-11-21 | Parser registry: one parser object per format, behind one `DocumentParser` interface, looked up by format in a map. A format with no parser (image) is `unsupported` | Adding a format is one file plus one registry entry. Unsupported formats are explicit, not silent | [AI-suggested] |
| D24 | 2026-11-21 | CSV becomes labelled text: a `Columns:` line, then `Row n: column=value; ...` per row. Empty cells show `(empty)`. Rows are capped at 500 with a warning, and the true row count is kept | The model sees field names next to values, which provenance and missing-info detection need. The cap keeps the text bounded | [AI-suggested] |
| D25 | 2026-11-21 | Per-document truncation at `MAX_CHARS_PER_DOCUMENT` (default 60000), with `wasTruncated` and a warning. Chunks of ~4000 chars with 200 overlap, offsets recorded. Chunks are recomputed from stored text, so offsets are deterministic | Large documents are bounded and the cut is visible. Offsets let a later snippet be traced back to a position in the document | [AI-suggested] |
| D26 | 2026-11-21 | In-process task queue with a concurrency limit (default 2). Production would use BullMQ or SQS | Simplest background processing that does not block the upload request. Known limitation: jobs are lost on restart | [AI-suggested] |
| D27 | 2026-11-21 | Raw bytes are freed after processing in every outcome (success or failure), not only after success | The file is no longer useful once it has been processed or has failed. Keeping it would only use memory | [AI-suggested] (the brief said after success) |
| D28 | 2026-11-21 | Parse timeout (`PROCESSING_TIMEOUT_MS`, default 20000) → `failed` with "took too long". Unexpected errors → a generic message, with details only in logs | Stops a hung parse from holding a queue slot forever, and keeps internals out of the UI | [AI-suggested] |
| D29 | 2026-11-21 | Two-stage prompting. Stage 1 sends one chunk of one document at a time and returns facts. Stage 2 sends only the structured facts, grouped by documentId, and never raw text | Keeps document boundaries. Cross-document reasoning runs on bounded, checkable facts, not a merged blob | [Assignment] |
| D30 | 2026-11-21 | Mock provider for offline use. It is rule-based, deterministic, and passes the same zod schemas. It is chosen automatically when `LLM_API_KEY` is empty | The app runs and can be demoed with no key or network. Output matches the real path, so the UI and tests exercise the same contract | [Assignment] (MOCK is required) and [AI-suggested] (the rule set) |
| D31 | 2026-11-21 | The mock reads the same `<document>` and `<facts_json>` delimiters that the prompt builders write. These delimiters are a contract between prompts.ts and the mock | Keeps the mock honest: it works from the prompt text, not from side channels. A prompt change that breaks the mock fails tests | [AI-suggested] |
| D32 | 2026-11-21 | One repair retry on invalid output. The zod issue paths and messages are sent back ("Return corrected JSON only"). A second failure throws `LLMOutputValidationError`. Raw model text never reaches the UI | Most format errors are fixed by one correction. Bounded cost, and no unvalidated output leaves the server | [Assignment] (structured output validated) and [AI-suggested] (one retry) |
| D33 | 2026-11-21 | Provenance and snippet guards run after every provider, mock or real. Unknown documentIds are removed. Findings with no valid source are dropped. Snippets not found in the document cap confidence at 0.3 with a warning | The model can still cite wrong ids or misquote text, so the server checks both no matter which provider produced the output | [Assignment] (provenance required) and [AI-suggested] (the confidence cap value) |
| D34 | 2026-11-21 | Prompt-injection guard in both system prompts: document content and facts JSON are untrusted data, and instructions inside them are ignored. Delimiter-like text inside documents is neutralised | Uploaded files are untrusted input. The guard is defence in depth, not a complete fix. Guards in D33 still apply even when the model is fooled | [AI-suggested] |
| D35 | 2026-11-21 | OpenAI SDK sits behind a narrow `ChatCompletionClient`. The SDK's own retries are off (`maxRetries: 0`), and retry policy is ours (one retry on network, 429, 5xx) | Tests use a fake transport with no network. Retry behaviour is explicit and testable | [AI-suggested] |
| D36 | 2026-11-21 | Analysis runs in two stages: independent per-document extraction (documents in parallel, concurrency 3, chunks in order within a document), then one cross-document call that receives only the facts, grouped by `documentId` | Keeps document boundaries and makes every fact traceable to one document before any comparison | [Developer] (specified for M6) |
| D37 | 2026-11-21 | Partial-failure tolerance: a failing document or chunk becomes a warning and the run continues. The run fails only when no document is extracted, the cross-document stage fails, or the time budget runs out. Facts already extracted are kept on failure | One bad document should not discard the others, and a failed run should still show what was read | [Developer] (specified for M6) |
| D38 | 2026-11-21 | `POST /api/analyses` runs synchronously and returns the full result. A failed run also returns 200 with `status: "failed"`. Production would use a job id with polling or SSE | Simplest correct flow for a time-boxed assignment. The cost is a long-held request, recorded as a scope trade-off | [Developer] (sync API as a scope trade-off) |
| D39 | 2026-11-21 | Problem documents (failed, unready, unknown) are skipped with a warning. The request returns 409 only when no document is usable. Total run budget is `ANALYSIS_TIMEOUT_MS` (120 s) and is cooperative: it stops new provider calls | Partial results are more useful than a rejected batch. A hard abort of in-flight calls needs a worker thread or an abortable provider | [AI-suggested] |
| D40 | 2026-11-21 | Markdown export is generated server-side by a pure formatter and served from `GET /api/analyses/:id/export`. The frontend copy button reuses it | One formatter, tested once. Sources, fact and interpretation sections, and escaping are not duplicated in the UI | [Developer] (specified for M6) |
| D41 | 2026-11-21 | Guards on stage B output: a factId must belong to the document it is cited under, and missing snippets are filled from the fact. Findings are stored by type, so missing information is always split from findings | Closes the M5 gap where a fact from one document could be cited under another. Keeps the UI's two lists consistent | [AI-suggested] |
| D42 | 2026-11-21 | A document used by any analysis cannot be deleted (409 `DOCUMENT_IN_USE`) | Deleting would cascade into `finding_sources` and leave findings with no source, which would make the saved analysis unreadable | [AI-suggested] |
| D43 | 2026-11-21 | Provenance UX: every finding shows one source badge per supporting document. Hover or focus shows the quoted snippet. A click switches to Extracted facts, opens that document's accordion, and highlights the fact | The brief requires provenance to be visible and checkable from the finding itself, without hunting through tables | [Developer] (specified for M7) |
| D44 | 2026-11-21 | Facts and AI interpretation are visually separate everywhere: facts use a neutral style with a "Fact" tag; AI interpretation uses the indigo accent with an "AI" tag, and each section is labelled | The brief requires separation in the UI, not just in the data model. The tag text is the signal, so colour is not the only cue | [Developer] (specified for M7) |
| D45 | 2026-11-21 | The document list polls `GET /api/documents` every 1.5 s, only while a document is `uploaded` or `processing`. No websockets or SSE | Simple, and enough for a short processing window. Push updates would add a connection lifecycle for little gain at this scope | [Developer] (polling over websockets for scope) |
| D46 | 2026-11-21 | The client reads upload and analysis limits from `GET /api/limits`, not from the shared `DEFAULT_LIMITS` | The shared default for file size (5 MB) differs from the server default (10 MB), and the server reads its limits from the environment. A client pre-check must match the server it talks to | [AI-suggested] |
| D47 | 2026-11-21 | Copy and download output always comes from `GET /api/analyses/:id/export`. If the clipboard is blocked, the text is shown in a read-only textarea for manual copy | One formatter, so copied output matches what the server exports. The fallback covers browsers and contexts where clipboard access is refused | [AI-suggested] |
| D48 | 2026-11-21 | The analysing stage text is a timed estimate (switches after 4 s). It is not reported by the server | The analysis is one synchronous request with no progress events. Saying so in the code and docs is more honest than fake progress | [AI-suggested] |
| D49 | 2026-11-21 | Fictional loan scenario: Nimbus Agro Foods Pvt Ltd, with obviously fake identifiers (`FSL-TEST-0042`, `+91-00000-00000`, example.com). Planted discrepancies: applicant name, address, licence expiry, revenue (three values). Planted consistent item: company-name variant. Planted missing items: co-director and KYC revenue | Gives a realistic demo of every output type, with known answers to check against. The full checklist is in `samples/EXPECTED_FINDINGS.md` | [Developer] (scenario and planted items specified for M8) |
| D50 | 2026-11-21 | The sample PDF is generated by `scripts/generate-samples.ts` with pdfkit, using fixed metadata dates. The generator and its output are both committed. Files are rewritten only when their bytes change | The generator is reviewable, and reruns give byte-identical output with clean diffs | [Developer] (specified for M8) |
| D51 | 2026-11-21 | `scripts/seed.ts` uses the same services as the upload route (`validateUpload`, the documents repo, the buffer store and `processor.processNow`). It skips any sample whose file name is already in the database | No raw SQL and no second processing path. Running it twice is safe | [AI-suggested] |
| D52 | 2026-11-21 | MOCK key canonicalisation: filler words (`annual`, `total`, `declared`, `registered`, `trade`, `the`, `of`, `no`, `number`, `name`) are dropped, `directors` maps to `director`, and the period token (`fy2025`) is always kept | Lets the MOCK match labels across documents without an LLM. Different years are never merged. Known limit: a fixed list, not semantic matching | [AI-suggested] |
| D53 | 2026-11-21 | Long-form CSV: when the first column is a row label (`metric`, `item`, `particulars`, `description`, `line`, and similar), each other column becomes a composite fact `<row label>_<column>`, and its snippet is the whole row | Financial tables use metrics as rows and periods as columns. Without this, the period values have no metric name | [AI-suggested] |
| D54 | 2026-11-21 | Company suffix variants compare equal (`Pvt` and `Private`, `Ltd` and `Limited`). A formatting variant is reported as consistent, not as a discrepancy | The brief asks for name variants to be consistent or low severity. Expanding the common suffixes covers this set. A real LLM would judge wider variants | [AI-suggested] |
| D55 | 2026-11-21 | `samples/EXPECTED_FINDINGS.md` is the acceptance target. `server/src/analysis/samples.test.ts` asserts the planted discrepancies, the consistent company name, the missing co-director and KYC revenue, and the rejected invalid files. Items that need real judgement (licence probably expired, "provisional" revenue, EMI impact) are documented as needing an LLM and are not asserted | Keeps the test honest about what the MOCK can do, and still fails if a planted item regresses | [Developer] (specified for M8) |
| D56 | 2026-11-21 | The scripts live in a root `scripts/` folder, which is a standalone ESM package (`scripts/package.json`), not an npm workspace. It is typechecked with `tsc -p scripts/tsconfig.json` | Keeps the workspaces as the folder structure lists them (`shared`, `server`, `client`). The seed script imports server services directly | [AI-suggested] |
