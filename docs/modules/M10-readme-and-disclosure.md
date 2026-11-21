# M10 — README, AI disclosure, final cleanup

**Status:** Done (submission-ready, with the manual checks listed below)

## Goal
A submission-ready repository: clear README, honest disclosure, clean history.

## Scope
- README sections: overview, quick start, 60-second demo, architecture (mermaid diagram, folder structure, data model, why facts and findings are separate), completed functionality mapped to the brief, assumptions, known limitations, security considerations, productionisation, testing, AI disclosure and developer decisions.
- AI tools disclosure: tools used, how they were used, and a draft "developer decisions" list built only from `[Developer]` rows in the DECISIONS LOG. The list is marked for the developer to review.
- Final cleanup: logs routed through the logger, environment file checked against the code, `.gitignore` checked, a clean-state install attempted, and the happy path run over the dev proxy.

## Deliverables
- [x] README complete
- [x] AI disclosure section (draft, marked `TODO(Sachin)` for review)
- [x] Final checks green: `npm run check` passes after a clean install (see below)
- [x] Commit history reviewed (not rewritten)

## Cleanup results
- **Environment file.** All 13 variables read by `server/src/config/env.ts` appear in `.env.example`, with defaults and comments. `LLM_API_KEY` is empty. A scan of the tree found no keys, tokens or private keys.
- **Ignore rules.** `.gitignore` covers `node_modules`, `.env`, `/data`, `dist`, SQLite files, logs and OS and editor files.
- **Console output.** Server runtime output goes through `logger`. The remaining `console.*` calls are in the CLI scripts (`seed`, `generate-samples`, `db:reset`), where printed output is the purpose.
- **TODOs.** None left in code. The only `TODO` is the review marker in the README's developer-decisions section, on purpose.
- **Dependencies.** Each declared dependency has at least one import, or is used by a script or a test config (`jsdom`, `concurrently`).
- **Type safety.** No `any`, no `@ts-ignore` and no `@ts-expect-error` in source or tests.

## Clean-state run (this machine)
1. Removed `data/`, every `node_modules` and every build output.
2. `npm ci` **failed** in `better-sqlite3`. Version 13.2.0 runs `node-gyp rebuild` during install, and this machine has no Visual Studio C++ tools. The package does ship a prebuilt `win32-x64` binary.
3. `npm install --ignore-scripts` succeeded. `better-sqlite3` loads from the shipped binary (verified).
4. `npm run samples:generate`: all sample files `unchanged` (byte-identical).
5. `npm run check`: typecheck exit 0. Tests: shared 8, server 137 (16 files), client 2. Total 147 tests in 19 files, all passing.
6. `npm run dev` happy path, through the Vite proxy on :5173:
   - health, limits and the client page respond;
   - four valid files upload and are processed;
   - `script.exe` is rejected with `UNSUPPORTED_EXTENSION`, and the invalid `fake.pdf` and `empty.txt` are rejected with `SIGNATURE_MISMATCH` and `EMPTY_FILE`;
   - the analysis completes with the MOCK provider, four discrepancies and 21 missing-information entries, every finding with sources;
   - the markdown and JSON exports respond;
   - an unknown API route returns the 404 envelope.
   The dev log has no errors.

## Known gaps for the submission
- The UI was not opened in a real browser. Verification was automated tests plus HTTP calls.
- `npm install` on Windows without C++ build tools fails in `better-sqlite3`. The workaround is `npm install --ignore-scripts`, documented in the README.
- The MOCK's missing-information list is noisy (21 entries on the sample set).
- The live OpenAI path has not been run against an endpoint.
- ESLint is not configured.

## Acceptance
- A new reviewer can clone, copy `.env.example`, run `npm install && npm run dev`, and use the app without a key.
  - On Linux and macOS this works as written. I did not run it on those platforms in this session.
  - On Windows without C++ build tools, use `npm install --ignore-scripts` (documented in the README).
