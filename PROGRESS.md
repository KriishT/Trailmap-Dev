# PROGRESS

Branch: `trailmap-evidence` (off `main` @ d31b244). Target: Trailmap Evidence (see the build prompt).

Environment: Windows 11, Node v24.14.0, npm 11.9.0. **Docker is not installed** on this machine, so
the local database for RLS tests is `@electric-sql/pglite` with an `auth` schema shim
(`supabase/tests/auth-shim.sql`), running the real migrations. The Supabase CLI path needs Docker.

## Phase 0: Recon and baseline (DONE)

Baseline on a clean install: build failed (CLI tsup `--banner`), lint failed (no ESLint config),
`check-types` passed, 29 prod vulnerabilities, scanner export map wrong, self-scan produced
24 nodes / 25 edges with ~17 phantom edges (regex definitions matching themselves, `.env.example`
placeholder, duplicate redis edge, workspace configs typed as services).

## Phase 1: Foundations, security, test infrastructure (IN PROGRESS, core done)

Done:
- Known 1 (CLI build): `packages/cli/tsup.config.ts` with `banner`.
- Known 2 (scanner exports): scanner is `"type": "module"`; ESM `index.js`, CJS `index.cjs`; both verified by import and require.
- Known 3 (turbo outputs): `dist/**` added; `check-types` now depends on `^build`.
- Known 4 (lint): every package has an `eslint.config.js`; `@repo/eslint-config` import fixed to `@trailmap/eslint-config`. Web lint runs with `--max-warnings 0` and is clean.
- Known 5 (fonts): `next/font/google` replaced by self-hosted IBM Plex via `next/font/local` (OFL license shipped in `apps/web/app/fonts`). Builds offline.
- Known 6: `packages/scanner/test.mjs` removed (real suite arrives in Phase 2).
- Known 7, 8: Redis and the Twilio placeholder removed from compose and `.env.example`. Gitleaks over full history: **not yet run** (binary not installed; CI job added, local run pending).
- Known 11 (webhook fails open): `lib/webhook-signature.ts` fails closed; route returns 500 when the secret is unset, 401 on mismatch. Tested.
- Known 12, 13 (IDORs in scan and share): access is checked through the user's own Supabase client, so RLS decides. Cross-tenant requests get 404. Also fixed the same class of bug in: `impact`, `impact/comment`, `scan-logs`, the repo page, the dashboard.
- **Extra finding, fixed:** `proxy.ts` listed `"/"` as a public prefix, so *every* path counted as public and the sign-in redirect never fired. Now exact-match for `/`; unauthenticated `/api/*` gets JSON 401. Tested.
- **Extra finding, fixed:** the sync route created organizations but never an `org_members` row, so owners would have failed every membership check. Migration 003 adds a trigger and backfill.
- **Extra finding, fixed:** Supabase's default privileges grant EXECUTE on new functions to `anon`/`authenticated`; `REVOKE ... FROM PUBLIC` alone left `claim_scan_job()` callable by anyone. Caught by a test; migration revokes from those roles explicitly.
- Known 14 (shared_maps RLS): `USING (true)` removed; `password_hash` column not readable by API roles; public page resolves a single slug through `get_shared_map()` (SECURITY DEFINER, hides expired links, exposes `requires_password` boolean only). Insert policy requires membership of the snapshot's org.
- Known 15 (in-process scans): `lib/scan.ts` deleted. Routes and the webhook only enqueue (`lib/queue.ts`, reuses an unfinished scan for the same repo). `packages/pipeline` is the single executor; the worker is a thin shell around it.
- Known 16 (non-atomic claim): `claim_scan_job()` uses `FOR UPDATE SKIP LOCKED`; worker calls it via `rpc`.
- Known 17 (installation events): `installation` created/deleted and `installation_repositories` handled; default branch fetched from GitHub; existing repos are not reset.
- Known 18 (root rename): scanner takes `repoName`; no post-hoc node renaming. (Full stable ids come in Phase 2.)
- Known 20 (map page tokens): page rewritten around the public RPC; shadcn tokens still referenced in the header markup, to be replaced in Phase 5.
- Known 21 (`any` in graph code): `packages/graph` holds a zod schema (`GRAPH_SCHEMA_VERSION = 1`) used by scanner types, pipeline (validated on write) and web (`readSnapshotGraph`, validated on read). `any` removed from `github-pr-impact.ts` and the pages.
- Removed the dev-only `/api/dev/scan` and `/dev/scan` (arbitrary local path scan; duplicated the CLI).
- Vitest + pglite harness (`supabase/tests`), a supabase-js-compatible adapter (`pg-client.ts`) so route handlers run against real RLS, Playwright config, CI workflow.

Tests (55 passing): graph schema (6), webhook signature (5), public routes (3), RLS and shared maps and claim (13), route authz including user-A-vs-org-B on every route and webhook paths (18), pipeline (10).
Mutation checks done: giving the user client service-role rights fails 4 isolation tests; removing temp cleanup fails 3; removing redaction fails 1.

Not done yet in Phase 1:
- Known 9 (starter READMEs, `packages/ui` starter components): Phase 5/6.
- Known 19 (MCP cloud endpoint + API keys): Phase 3.
- Webhook payload fixtures with msw for pull_request / installation flows: only `push` is covered at route level; handler-level tests for installation events still to write.
- True multi-connection concurrent claim test: pglite is single-connection, so the race test proves exactly-once only sequentially. Needs real Postgres (CI service container) to prove the SKIP LOCKED path.
- Coverage thresholds (>= 80%) not enforced yet.
- `packages/ui` lint/check-types are `echo skip`.

## Decisions
- Local DB for tests: pglite + auth shim (no Docker available).
- Authorization by RLS, not by hand-written membership code: routes query through the user's client; service-role client only for writes. Keeps one source of truth, covered by DB tests.
- Evidence snippets (Phase 2) are short excerpts of source lines. "Source code is never stored" is therefore stated as "no repository contents are retained; graph evidence includes at most a 120-character excerpt per cited line", to be documented in SECURITY.md.

## Next
Finish remaining Phase 1 items above, then Phase 2 (scanner accuracy: fixture corpus, eval harness, env-read-only connections, IaC, vendor inventory, data classification).
