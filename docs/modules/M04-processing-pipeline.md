# M4 — Document processing pipeline

**Status:** Done (2026-11-21)

## Goal
Turn each uploaded document into clean, bounded text with metadata. Keep every document separate, and never let one failure stop the batch.

## What was built
- **Parser interface** (`server/src/processing/parsers/types.ts`): `DocumentParser { format, parse(buffer, meta, options) }`. Typed errors: `UnsupportedFormatError`, `DocumentParseError` (user-safe message).
- **Parsers** (one file each): `txtParser` (strict UTF-8, normalised), `pdfParser` (pdf-parse v2, page count, no-text detection), `csvParser` (papaparse, `Columns:` header line, `Row n: column=value; ...` lines, rows capped at 500 with a warning).
- **Registry** (`parsers/registry.ts`): format → parser map. `image` has no parser, so it is `unsupported`. Unknown formats throw `UnsupportedFormatError`.
- **Text functions** (`processing/text.ts`, pure): `normalizeText`, `truncateText`, `chunkText` (4000 chars, 200 overlap, breaks on paragraph, line, sentence, then word).
- **Finalize** (`processing/finalize.ts`): normalise → truncate to `MAX_CHARS_PER_DOCUMENT` (sets `wasTruncated` and adds a warning) → chunk → zod-validate `ParsedDocument`.
- **Orchestrator** (`processing/index.ts`): `enqueue`, `processNow`, `whenIdle`, `getParsedDocument`. Sets `processing`, runs the parser with a timeout, then saves text and status `processed`, or `failed` / `unsupported` with a safe message. Frees the raw bytes in every outcome.
- **Queue** (`processing/queue.ts`): in-process, concurrency limit (`PROCESSING_CONCURRENCY`, default 2).
- **API**: `GET /api/documents/:id` now returns `DocumentDetail` (status, pages, rows, columns, warnings, preview of 500 chars). `GET /api/documents/:id/text` returns full text after processing, or 409 `NOT_PROCESSED`.

## Deliverables
- [x] Parser interface and registry
- [x] PDF, TXT, CSV parsers
- [x] Chunker with truncation flag
- [x] Per-document status written to `documents`

## Acceptance
- [x] A corrupt PDF gets `failed` with a readable message, and the server keeps answering (integration test).
- [x] Other documents in the same batch still process (batch test: one corrupt PDF plus one TXT).
- [x] Large text is truncated with a visible warning and `wasTruncated: true`.

## Notes
- OCR is not implemented. Scanned PDFs fail with a clear message. Images are `unsupported`.
- The queue is in memory. Production would use BullMQ or SQS.
- Existing dev DBs need `npm run db:reset` (new `parse_info_json` column).
- See CLAUDE.md, M4 PROGRESS LOG entry, for known issues.
