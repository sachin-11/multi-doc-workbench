# M9 — Tests (pipeline + analysis provenance)

**Status:** Not started (a smoke test for `/api/health` already exists from M1)

## Goal
Meaningful automated tests for the parts that matter most: validation, parsing, and provenance.

## Scope
- Upload validation: type, size, count, filename sanitisation, traversal name.
- Parsers: TXT and CSV full tests; PDF with a small synthetic fixture; corrupt file yields `unreadable`.
- Chunking: truncation flag set for oversized input.
- Analysis: every finding has non-empty `sources` pointing at real document IDs; facts and interpretation stay separate.
- Route tests with supertest for upload errors (400/413/415 envelope).

## Deliverables
- [ ] Unit tests for validation and parsers
- [ ] Provenance test for the analysis engine
- [ ] Route tests for error responses

## Acceptance
- `npm test` passes and covers the points above.
