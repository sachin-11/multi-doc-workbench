# M2 — Shared types/schemas + SQLite schema

**Status:** Done (2026-11-21)

## Goal
Define the data contracts once (zod in `shared/`) and the relational schema in SQLite, with facts and interpretation kept separate.

## What was built
- `shared/src/documents.ts`: `DocumentFormat` (`pdf | txt | csv | image`), `DocumentStatus` (`uploaded | processing | processed | failed | unsupported`), `DocumentMeta`.
- `shared/src/facts.ts`: `ExtractedFact` (key, value, normalizedValue, category, sourceSnippet ≤ 200 chars, confidence 0–1, `documentId`). These are facts, not interpretation.
- `shared/src/analysis.ts`: `Finding` (type, `sources: { documentId, factId, snippet }[]` with min 1, `isInterpretation: true`), `ComparisonTable`, `AnalysisRequest` (factory takes the max document count from config), `AnalysisStatus`, `AnalysisProvider`, `AnalysisResult`.
- `shared/src/llmOutput.ts`: `PerDocumentExtractionOutput`, `CrossDocumentAnalysisOutput`, and `findUnknownSourceDocumentIds`.
- `shared/src/constants.ts`: supported formats, MIME and extension maps, default limits.
- `shared/src/api.ts`: `ApiErrorSchema` (`details` optional).
- `server/src/db/schema.sql`: tables `documents`, `analyses`, `analysis_documents`, `extracted_facts`, `findings`, `finding_sources`. CHECK constraints, FKs, indexes.
- `server/src/db/client.ts`: `openDatabase(path)`. Enables WAL and foreign keys, applies the schema (idempotent).
- `server/src/db/repositories/`: `documentsRepo`, `analysesRepo` (prepared statements, transactions, zod validation on write and read).
- `server/src/db/reset.ts`: `npm run db:reset` deletes the DB file.

## Deliverables
- [x] Zod schemas and inferred types exported from `@mdw/shared`
- [x] SQLite schema file + migration-on-start (`CREATE TABLE IF NOT EXISTS`)
- [ ] Seed script (optional, not done)
- [x] Unit test: a finding without `sources` is rejected (plus a provenance round-trip test)

## Acceptance
- [x] `npm run typecheck` and `npm test` pass (6/6).
- [x] No `any`.
- [x] Facts and interpretation are separate tables and types.

## Notes
- DB file lives under `data/` (git-ignored). Path set by `DB_PATH`.
- Known issues are listed in CLAUDE.md under the M2 PROGRESS LOG entry.
