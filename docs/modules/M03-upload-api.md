# M3 — Upload API + file validation + secure handling

**Status:** Done (2026-11-21). Manual curl smoke test not run. Route coverage is from supertest.

## Goal
Accept multiple files safely, keep them out of the file system, and report each file's result without failing the whole batch.

## What was built
- `POST /api/documents`: multipart, field `files`, memory storage only (multer). Returns `{ accepted: DocumentMeta[], rejected: { originalName, code, reason }[] }` (shared `UploadResponseSchema`).
- Validation (`server/src/upload/validation.ts`, pure functions): extension allowlist, declared MIME matches the extension, empty file, magic bytes (PDF `%PDF-`, PNG and JPEG signatures), TXT and CSV valid UTF-8 with no NUL bytes. Filename sanitisation: strips path segments, control characters and unsafe symbols, caps length, no leading dots.
- Storage: a DB row for every **accepted** file (status `uploaded`). A file that fails validation is reported in the response and is **not stored** (changed after M10, see the note below). Raw bytes for accepted files only, in an in-memory store with TTL (`server/src/storage/bufferStore.ts`).
- `GET /api/documents` (metadata only), `GET /api/documents/:id` (UUID validated), `DELETE /api/documents/:id` (returns 204).
- `enqueueProcessing(id)` placeholder in `server/src/processing/index.ts` for M4.
- Errors: multer, zod and body-parser errors map to the shared ApiError envelope. No stack traces in responses. `helmet` added.

## Deliverables
- [x] Upload route with multipart parsing (memory storage)
- [x] Validation module with unit tests (type, size, count, sanitisation)
- [x] Path traversal test (`../../etc/passwd.txt` becomes `passwd.txt`)
- [x] Per-file result: accepted or rejected with reason

## Acceptance
- [x] Wrong-type, traversal-named, fake-PDF, empty and too-many-file cases are rejected with the standard error envelope. Too-many returns 413.
- [x] Valid files are stored and listed.
- [ ] Oversized files are covered by multer config only. No test yet that sends an oversize body.

## Notes
- Oversized files and too many files reject the whole request with 413 (multer limits). All other checks are per file.
- Raw bytes are lost on restart. A document row can exist without bytes. M4 must handle that case.
- See CLAUDE.md, M3 PROGRESS LOG entry, for the known-issues list.

## Update after M10: rejected files are not stored
Originally every file got a DB row, rejected ones with status `unsupported` or `failed`. The client's own pre-check rejects some files before they reach the server, so only the server-side rejections appeared in the document list, and the list was inconsistent. The rule is now: **validation failures are shown once in the upload alert and never listed.** An accepted file that cannot be processed later (corrupt PDF, image without OCR) is still stored and shows as `failed` or `unsupported`. `DocumentMeta.format` stays nullable for compatibility, but the upload route no longer produces a null format.
