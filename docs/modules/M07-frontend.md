# M7 — Frontend

**Status:** Done (verified with a jsdom app-level test and the live dev stack; not clicked through in a real browser, see known issues)

## Goal
A usable single-page flow: upload, prompt, run, read results with provenance.

## Scope
- Upload area (multi-file, shows per-file errors from the API and a client pre-check).
- Document list with processing status, warnings, errors, delete, and include/exclude for analysis.
- Prompt input with example prompts from the brief.
- Results tabs: summary, comparison table, discrepancies, missing information, extracted facts.
- Source badges on every finding (document names, hover or focus shows the snippet, click jumps to the document's facts).
- Visual separation: "Fact" tags and neutral style versus "AI" tags and the indigo accent.
- Copy as Markdown, Copy JSON and Download .md, all from the export endpoint.
- Loading, empty, and error states.

## Deliverables
- [x] Upload component and document list (`UploadDropzone.tsx`, `DocumentList.tsx`, `hooks/useDocuments.ts`)
- [x] Prompt form and run action (`InstructionPanel.tsx`, `hooks/useAnalysis.ts`)
- [x] Results view with the five sections (`ResultsTabs.tsx`, `ComparisonTable.tsx`, `FindingCard.tsx`, `FactsByDocument.tsx`)
- [x] Copy button, with a fallback textarea when the clipboard is blocked (`CopyButton.tsx`)
- [x] Error and empty states
- [x] Test: `FindingCard` with two sources shows both badges and the AI tag (`components/FindingCard.test.tsx`)
- [x] Test: happy path through `App` with fetch answered by fixtures (`App.test.tsx`)

## Acceptance
- [x] Full flow works with the mock provider: upload two TXT files, see them become Ready, use an example instruction, analyse, read the sourced results, copy, and jump from a source to its facts (covered by `App.test.tsx` in jsdom, and the same calls verified through the Vite proxy).
- [ ] Phone width: no horizontal scroll on the main page. The CSS is written for it (single column below 900px, tables scroll inside their own wrapper), but it has not been checked in a browser.

## Files
- `client/src/api/client.ts`: typed fetch client. Every response is parsed with the shared zod schemas. Errors become `ApiRequestError` with the server's code and message.
- `client/src/lib/precheck.ts`: client pre-check (count, extension, image, empty, size), with friendly messages.
- `client/src/hooks/useDocuments.ts`, `client/src/hooks/useAnalysis.ts`
- `client/src/components/*`: `UploadDropzone`, `DocumentList`, `InstructionPanel`, `ResultsTabs`, `ComparisonTable`, `FindingCard`, `FactsByDocument`, `SourceBadge`, `CopyButton`, `StatusChip`, `Tag`
- `client/src/App.tsx`, `client/src/styles.css`, `client/vitest.config.ts`
- Backend gap (small): `GET /api/limits` (`server/src/routes/limits.ts`, `LimitsResponseSchema` in `shared/src/api.ts`). See the decision below.

## Known issues
- **Backend change for limits.** The shared `DEFAULT_LIMITS.maxFileSizeMb` is 5, but the server default is 10 MB. The client therefore reads `GET /api/limits`, which the server builds from its real config.
- **Warnings come from a second request per document.** The list endpoint does not include `warnings`, so the client fetches `GET /api/documents/:id` once per processed document.
- **Stage text is an estimate.** The analysis is one synchronous request, so the server reports no stages. The UI switches from "Extracting facts per document…" to "Comparing across documents…" after 4 seconds.
- **Polling, not push.** The document list polls every 1.5 s, but only while a document is `uploaded` or `processing`.
- **Not browser-clicked.** The verification used jsdom with fetch fixtures, plus the live dev proxy with curl. No real browser was available in this session, so layout, focus styles, the hover popover and the phone-width check have not been seen.
- **No Analysis history UI.** `GET /api/analyses` exists, but the page shows only the latest run.
- **Dark mode is CSS-only.** It follows `prefers-color-scheme`, with no toggle.
- **Tabs are a simple WAI-ARIA pattern.** Arrow keys move between tabs. Focus is not trapped.
