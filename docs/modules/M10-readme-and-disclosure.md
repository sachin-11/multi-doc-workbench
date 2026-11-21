# M10 — README, AI disclosure, final cleanup

**Status:** Not started

## Goal
A submission-ready repository: clear README, honest disclosure, clean history.

## Scope
- README sections (skeleton already exists): overview, setup, architecture, assumptions, completed functionality, known limitations, security considerations, productionisation, testing.
- AI tools disclosure: which tools were used and for what.
- "Developer decisions" section built from the DECISIONS LOG in `CLAUDE.md`. Only items the developer actually confirmed are listed as the developer's own.
- Final cleanup: remove dead code, unused deps, TODOs; run `npm run build`, `npm run typecheck`, `npm test`; confirm `.env.example` is complete.

## Deliverables
- [ ] README complete
- [ ] AI disclosure section
- [ ] Final checks green
- [ ] Commit history reviewed

## Acceptance
- A new reviewer can clone, copy `.env.example`, run `npm install && npm run dev`, and use the app without a key.
