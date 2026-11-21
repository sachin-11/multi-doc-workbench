# M1 — Project setup + CLAUDE.md

**Status:** Done (2026-11-21)

## Goal
A running monorepo skeleton: TypeScript strict on both sides, one shared package, a health endpoint, a page that calls it through the dev proxy, and `CLAUDE.md` as persistent memory.

## Deliverables
- [x] npm workspaces: `shared/`, `server/`, `client/`, `samples/`
- [x] Root scripts: `dev`, `build`, `test`, `typecheck`
- [x] Express app with `GET /api/health`, CORS for the Vite origin, JSON 404 for unknown `/api` routes
- [x] Central error handler (`AppError` + envelope)
- [x] zod-validated env loading (`PORT`, `CLIENT_ORIGIN`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `MAX_FILE_SIZE_MB`, `MAX_FILES`)
- [x] Vite React page that calls `/api/health` via proxy
- [x] `.gitignore`, `.env.example`, strict `tsconfig`
- [x] `CLAUDE.md`, `README.md` skeleton, one doc per module

## Acceptance checks
| Check | Command | Result |
|---|---|---|
| Install | `npm install` | OK |
| Typecheck | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0 |
| Tests | `npm test` | 3 / 3 pass |
| Dev servers | `npm run dev` | server :4000 and client :5173 start |
| Health (direct) | `curl localhost:4000/api/health` | `status: ok` |
| Health (proxy) | `curl localhost:5173/api/health` | `status: ok` |
| Unknown route | `curl localhost:4000/api/nope` | 404 envelope |

## Files touched
`package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `CLAUDE.md`, `README.md`, `docs/modules/*`, `samples/README.md`, `shared/*`, `server/*` (incl. `vitest.config.ts`), `client/*`

## Decisions
See `DECISIONS LOG` in `CLAUDE.md` (D1–D8).

## Known issues
- `predev` builds `shared` first. Running `tsx` or vitest directly needs `npm run build -w @mdw/shared` first.
- Vitest must exclude `dist/`, otherwise compiled test files run twice (fixed via `server/vitest.config.ts`).

## Next step
M2: shared Zod schemas (documents, analyses, findings) and the SQLite schema + seed.
