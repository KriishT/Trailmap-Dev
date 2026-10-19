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

## Phase 2: Scanner accuracy and new capabilities (DONE)

- Replaced regex-over-raw-text detection with a tokenizer (JS/TS, Python, Go, Java, C#, Ruby). Comments and regex literals never become tokens; imports, env reads, URLs in client calls, connection strings, listen calls and vendor call sites are extracted from real code only. `.env.example` is "declared" evidence and never creates an edge. Test/spec/fixture/doc/vendored files, unused imports and `if (false)` blocks are ignored. Tooling configs (`eslint.config.js` etc.) are ignored.
- Graph schema v2: file/line/snippet on every evidence entry, stable node and edge ids, `graphHash`, `scannerVersion`, data-class tags (`evidenced` / `possible`), node `exposure`/`public`, IaC provenance. Snippets mask URI credentials, secret-named values and well-known token formats.
- IaC: Terraform (via `@cdktf/hcl2json`), CloudFormation (intrinsic tags), Helm (best-effort rendering), Kubernetes, docker-compose. Public ingress/egress flagged, ALB -> service -> datastore edges, internet node.
- Vendor catalog (`vendors.json`, 39 vendors) and engine catalog (`engines.json`, 17 datastores/queues/stores) as data.
- Data classification from Prisma, SQL, SQLAlchemy/Django, ActiveRecord schema.rb, TypeORM/JPA/EF entities, Go struct tags, OpenAPI, and vendor SDK call sites.
- Eval harness (`npm run eval`): 9 fixtures + trap repo + this repo as a regression fixture; gates service->service and service->vendor precision >= 0.90 and recall >= 0.80, determinism, and zero phantom edges. Writes `docs/accuracy.md`. 2,000-file scan: ~3 s.
- Honest caveat recorded in `docs/accuracy.md`: the fixtures were written together with the scanner, so 100% on them is not an estimate of accuracy on arbitrary codebases.
- Self-scan went from 24 nodes / 25 edges (~17 false) to 13 nodes / 15 edges, all real.
- Bugs the tests found along the way: a latent CloudFormation resource-type parsing bug, a secret leaking into evidence snippets, a missing `build.dockerfile` attribution.

## Phase 3: Compliance layer (DONE, integrations not yet wired to a route)

- `packages/graph`: diff, scope analysis, policy (`.trailmap.yml`), drift rules with stable finding keys, overrides, vendor inventory + CSV + DORA register assist, impact/blast radius, CODEOWNERS.
- `packages/frameworks`: SOC 2, PCI DSS 4.0.1 (1.2.3, 1.2.4, 12.5.2), DORA Art. 28(3) as JSON config with `verify` notes; a test forbids certification claims.
- Migration 004 with RLS on every table: scopes, scope_members, graph_overrides, drift_events, attestations (immutable except for FK actions), vendors, audit_events (append-only by trigger, automatic row auditing, secrets excluded), api_keys (hash only; column grants hide the hash), exports, repo_policies, share-link revocation + access log, job kinds.
- PR check pipeline: clone PR head, scan, diff against the latest snapshot, evaluate drift, create a Check Run and one upserted comment (drift first, blast radius in `<details>`). `/trailmap ack` (GitHub write access required) or the in-app action records an attestation bound to the head graph hash and re-runs the check to success; a new push needs a new acknowledgement.
- Webhook handler: push, pull_request, issue_comment, check_run (rerequested), installation, installation_repositories. Routes only enqueue.
- API keys (create/list/revoke, shown once), `/api/mcp/{graph,scope,check}/[repoId]`, `/api/ingest/[repoId]` (CI-only mode: graph JSON in, drift verdict out).
- Share links: bcrypt password, expiry, label watermark, revocation, access log (hashed IPs), rate-limited unlock with a signed cookie.
- CLI: `scan --upload`, `vendors`, `evidence --framework`, `check --base` (local git worktree) and `check --remote`. `action.yml`.
- MCP: original 6 tools + `get_compliance_scope`, `get_data_flows`, `check_change`; cloud client reads the real API shape.
- `packages/integrations`: bearer-token (Drata-style), OAuth client-credentials (Vanta-style), signed webhook with replay protection, downloadable pack; feature-flagged, retried, tested against mocked servers. Endpoints are configuration; no official partnership is claimed.
- Decisions: scope membership lives in `scope_members` (the "mark node in/out of scope" override); attestations are immutable by trigger but allow FK cascade (trigger depth > 1); API-key rate limiting is per instance (documented).

Tests: 324 passing (DB isolation incl. every compliance table, route authorization, webhook fixtures, PR check flow, CLI end-to-end against the built binary and real git, MCP via the SDK's in-memory transport, integrations via msw).

## Phase 4: Evidence workspace (DONE)

- Server: `lib/workspace/{load,export,scene,inspect,client-data}.ts`; routes for export, scene, scopes, overrides (create and revoke), vendors, policy; sample data in `lib/demo/` (committed `demo-data.json`, a test checks it equals the generator's output).
- UI: `components/workspace/*` (sheet viewer with inspector, keyboard navigation, scope editor with click/shift-click/lasso, vendors, revisions with time travel, review queue with j/k/a keys, export preview with title block, share links, settings and API keys, command palette), onboarding checklist on the dashboard, `/demo` without sign-in, share view at `/map/[slug]`.
- Found by the browser tests and fixed: the proxy blocked the share-link unlock route for signed-out visitors; a race in the sheet fetch could store an empty response after an abort and crash the page; stale `dist` of `localdb` was served until rebuilt (always `npm run build` before `next start`).

## Phase 5: Survey sheet design system (DONE)

- `packages/ui`: tokens (drafting paper and blueprint), components on Radix, IBM Plex Sans / Mono / Sans Condensed self-hosted, no inline-style theming, square corners, no gradients, glow or glass. Removed three.js, React Flow, dagre, framer-motion, Tailwind, the hero and starter files.
- Landing page shows the real product: the system sheet and revision list, drift finding, CLI output and evidence footnote are generated from the sample data.
- Axe (WCAG 2.2 AA plus best practice), zero serious or critical on the landing page, sign-in, every sample tab, dashboard, repository workspace tabs, export preview, share gate and shared view, in both themes. Screenshots at 1440 and 768 in both themes are in `docs/screenshots/` and were looked at.

## Phase 6: Docs (DONE)

README, `.env.example` files, SECURITY.md, ARCHITECTURE.md, CHANGELOG.md, `docs/accuracy.md` (generated), `docs/performance.md`.

## Verification (from a clean install)

See the final report. Test suites: vitest (unit, DB isolation, route authorization), eval gate, Playwright (demo, workspace, PR drift, onboarding, axe, responsive).

## Still open
- `docker compose up` not verifiable on this machine (no Docker installed).
- True multi-connection claim test needs real Postgres (CI service).
- Integrations delivery code is not called from any route yet.
- Screenshots were reviewed by eye on one machine; the Lighthouse run used mobile emulation against a local server.

## Next
1. Wire `packages/integrations` to an export-delivery route and a settings screen.
2. Concurrent claim test on a real Postgres service container in CI.
3. Measure scanner accuracy on real, third-party repositories (not authored with the scanner) and publish the numbers.
