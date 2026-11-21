# M7 — Frontend

**Status:** Not started

## Goal
A usable single-page flow: upload, prompt, run, read results with provenance.

## Scope
- Upload area (multi-file, shows per-file errors from the API).
- Prompt input with example prompts from the brief.
- Results tabs: comparison table, consolidated summary, discrepancies, missing information, key-values.
- Source badges on every finding (document names, click to highlight the document).
- Visual separation: "Extracted facts" vs "AI interpretation" labels.
- Copy-output button (per section, plain text / Markdown).
- Loading, empty, and error states.

## Deliverables
- [ ] Upload component and document list
- [ ] Prompt form and run action
- [ ] Results view with the five sections
- [ ] Copy button
- [ ] Error and empty states

## Acceptance
- Full flow works in the browser with the mock provider.
- Phone width: no horizontal scroll on the main page.
