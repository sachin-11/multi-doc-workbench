# M3 — Upload API + file validation + secure handling

**Status:** Not started

## Goal
Accept multiple files safely, store them outside the code tree, and reject invalid input with clear errors.

## Scope
- `POST /api/documents` (multipart, multiple files).
- Validation: MIME type and extension allow-list (PDF, TXT, CSV; image optional), size limit (`MAX_FILE_SIZE_MB`), count limit (`MAX_FILES`).
- Filename sanitisation (strip paths, control chars, limit length). Never use the client filename as a storage path.
- Storage in `uploads/` or memory, with generated IDs. No execution of content.
- `GET /api/documents` and `DELETE /api/documents/:id`.

## Deliverables
- [ ] Upload route with multipart parsing (memory or temp dir)
- [ ] Validation module with unit tests (type, size, count, sanitisation)
- [ ] Path traversal test (e.g. `../../etc/passwd` name)
- [ ] Per-file result: accepted or rejected with reason

## Acceptance
- Oversized, wrong-type, too-many, and traversal-named files are rejected with the standard error envelope.
- Valid files are stored and listed.
