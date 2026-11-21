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
- [ ] **M2** Shared types/schemas + SQLite schema (documents, analyses, findings) — [doc](docs/modules/M02-shared-schemas-and-db.md)
- [ ] **M3** Upload API + file validation + secure handling — [doc](docs/modules/M03-upload-api.md)
- [ ] **M4** Document processing pipeline (parser interface, PDF/TXT/CSV, chunking, error states) — [doc](docs/modules/M04-processing-pipeline.md)
- [ ] **M5** LLM provider abstraction (real + mock) + structured output with zod — [doc](docs/modules/M05-llm-provider.md)
- [ ] **M6** Analysis engine (per-doc extraction, then cross-doc comparison with provenance) — [doc](docs/modules/M06-analysis-engine.md)
- [ ] **M7** Frontend: upload UI, prompt input, results views (table, summary, discrepancies, missing info, key-values), source badges, copy button, error states — [doc](docs/modules/M07-frontend.md)
- [ ] **M8** Synthetic sample documents (application form PDF, supporting TXT, financials CSV with deliberate mismatches) — [doc](docs/modules/M08-sample-documents.md)
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
