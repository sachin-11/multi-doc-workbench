# M4 — Document processing pipeline

**Status:** Not started

## Goal
One parser interface, one implementation per format, with chunking and explicit error states.

## Scope
- `server/src/pipeline/parser.ts`: `DocumentParser` interface (`supports(mime)`, `parse(buffer) -> ParsedDocument`).
- Parsers: `pdf-parse` (PDF), plain text (TXT), `papaparse` (CSV, header row kept as field names). Image OCR (`tesseract.js`) is stretch only.
- Chunking per document with a size cap. Record `truncated: true` and the number of chunks so the UI can show a note.
- Error states per document: `unsupported`, `unreadable` (corrupt PDF, bad encoding), `empty`. Never fail the whole batch because one file failed.

## Deliverables
- [ ] Parser interface and registry
- [ ] PDF, TXT, CSV parsers
- [ ] Chunker with truncation flag
- [ ] Per-document status written to `documents`

## Acceptance
- A corrupt PDF gets `unreadable`, and the other documents still process.
- Large text is truncated with a visible note.
