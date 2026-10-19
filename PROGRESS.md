# PROGRESS

Branch: `trailmap-evidence` (off `main` @ d31b244). Target: Trailmap Evidence (see build prompt).

## Phase 0 — Recon and baseline (DONE 2026-10-19)

Environment: Windows 11, Node v24.14.0, npm 11.9.0. **Docker is not installed**, so the
local database for RLS tests will use `@electric-sql/pglite` with an `auth` schema shim
(decision recorded for Phase 1; the Supabase CLI needs Docker).

Baseline, run on a clean `npm install`:

| Check | Result |
|---|---|
| `npm run build` | FAIL: `@trailmap/cli` (tsup `--banner.js` -> `CACError: Unknown option --banner`); turbo warns no outputs for `@trailmap/scanner#build` |
| `npm run check-types` | PASS (6/6) |
| `npm run lint` | FAIL: scanner has no ESLint flat config ("couldn't find eslint.config"); web also unresolved |
| `npm audit --omit=dev` | 29 vulns (1 low, 6 moderate, 18 high, 4 critical) |
| scanner `dist/` output | `index.js` (CJS), `index.mjs` (ESM); package.json points at `index.js` as ESM and `index.cjs` for require -> exports map wrong (confirmed) |
| Self-scan | 24 nodes / 25 edges (confirmed phantom set below) |

Confirmed self-scan false positives (Known issue 10):
- `packages-scanner` -> postgres, mysql, mongodb, rabbitmq, kafka, redis, sendgrid, resend,
  openai, anthropic, sentry, datadog, segment, mixpanel (regex definitions matching themselves).
- `apps-worker` -> `ext-twilio` (from `.env.example`), and `apps-worker` -> redis as both `http` and `database`.
- `apps-web` -> postgres / redis (medium) with no real usage.
- `packages-ui`, `packages-typescript-config`, `packages-eslint-config` typed `service`.
Real edges: apps-worker/apps-web -> supabase, and the four `import` edges to packages-scanner.

Known issues 1-21 from the prompt are accepted as the work list; items 1, 2, 3, 4, 10 are
re-verified above. The rest are verified by code read (webhook `?? ""` secret, unauthenticated
service-role lookups in scan/share routes, `shared_maps_select USING (true)`, fire-and-forget
`scanRepo`, non-atomic claim in worker `index.ts`).

## Next
Phase 1 — foundations, security, test infrastructure.

## Decisions
- Local DB for tests: pglite + auth shim (no Docker available).
