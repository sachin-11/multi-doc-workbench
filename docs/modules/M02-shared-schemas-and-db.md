# M2 — Shared types/schemas + SQLite schema

**Status:** Not started

## Goal
Define the data contracts once (zod in `shared/`) and the relational schema in SQLite, with facts and interpretation kept separate.

## Scope
- `shared/src/documents.ts`: `DocumentMeta`, `DocumentStatus` (`uploaded | processing | ready | failed`), supported types.
- `shared/src/facts.ts`: `ExtractedFact` (value, kind, `documentId`, location/chunk reference).
- `shared/src/analysis.ts`: `Finding` with **required** `sources: documentId[]` (min 1), `kind` (table row, summary point, discrepancy, missing info, key-value), `interpretation` flag.
- `server/src/db/`: `better-sqlite3` connection, schema (`documents`, `document_facts`, `analyses`, `findings`), seed script.

## Deliverables
- [ ] Zod schemas and inferred types exported from `@mdw/shared`
- [ ] SQLite schema file + migration-on-start (simple `CREATE TABLE IF NOT EXISTS`)
- [ ] Seed script (optional demo rows)
- [ ] Unit test: a finding without `sources` is rejected

## Acceptance
- `npm run typecheck` and `npm test` pass.
- No `any`.
- Facts and interpretation are separate tables / types.

## Notes
- DB file lives under `data/` (git-ignored).
