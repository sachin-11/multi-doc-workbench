# M6 — Analysis engine (per-doc extraction, then cross-doc comparison)

**Status:** Not started

## Goal
Run the user's analysis prompt in two stages without ever merging documents into one unstructured prompt.

## Scope
1. **Per-document extraction** (independent): for each document, produce structured facts (`ExtractedFact` with `documentId`, location, value) and a per-document summary.
2. **Cross-document analysis** (collective): operate on the structured facts only. Produce:
   - comparison table (rows = fields, columns = documents)
   - consolidated summary
   - discrepancy list
   - missing-information report
   - key-value extraction
3. Every finding has `sources: documentId[]` (min 1). Findings without sources are rejected.
4. Facts and interpretation are stored and returned separately.

## Deliverables
- [ ] Stage 1 extractor per document
- [ ] Stage 2 comparer over facts
- [ ] Analysis result saved to `analyses` / `findings`
- [ ] Test: every finding has non-empty `sources` that reference real document IDs

## Acceptance
- A prompt over 3 docs returns all five output sections, each finding cites documents.
- Removing a document changes the result (proves it is used).
