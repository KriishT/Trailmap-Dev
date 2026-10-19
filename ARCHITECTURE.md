# Architecture

Trailmap turns a repository into a deterministic graph, layers human decisions on top, and renders the result as drawings and exports.

```
                 GitHub (push, pull_request, comments)
                                |
                    apps/web  /api/webhooks/github     verify signature, enqueue a job row
                                |
                         Postgres: scan_logs  (kind: scan | pr_check | pr_recheck)
                                |    claim_scan_job()  FOR UPDATE SKIP LOCKED
                    apps/worker  ->  packages/pipeline   (the only executor)
                                |
          clone to temp dir -> packages/scanner -> graph -> delete temp dir
                                |
        snapshot (graph_snapshots)  +  drift event / check run / one upserted comment
                                |
                     apps/web workspace: loadWorkspace(user client, RLS)
                                |
            packages/sheets  layout (ELK) -> one Scene -> screen SVG / exported SVG / PDF
```

## Packages

| Package | Responsibility |
|---|---|
| `scanner` | Directory in, graph out. A tokenizer (comments and regex literals never become tokens) extracts imports, env reads, calls, connection strings; separate passes read Terraform, CloudFormation, Helm, Kubernetes and compose. Evidence kinds give confidence. Stable ids (`service:<path>`, `db:postgres`, `vendor:stripe`, `tf:<address>`). |
| `graph` | Zod schema (`GRAPH_SCHEMA_VERSION = 2`), canonical hash (`graphHash`, excludes the scan time), diff, scope analysis, `.trailmap.yml` policy, drift rules with stable finding keys, overrides (confirm, hide, add, reclassify), vendor inventory, blast radius. |
| `pipeline` | The one executor: scan jobs and pull request checks. Dependencies (GitHub, cloning, temp dirs, scanning) are injected, so tests and local mode swap them. |
| `frameworks` | PCI DSS 4.0.1, SOC 2 and DORA notes as data, each with what a person must verify. A test forbids certification claims. |
| `sheets` | `layoutScene` (ELK layered, orthogonal routing, scopes as compound nodes) produces a `Scene`; `sceneToSvg` and `buildEvidencePdf` draw it. The screen, the exported SVG and the PDF are the same drawing. |
| `ui` | The Survey sheet design system: CSS tokens (drafting paper, blueprint), components on Radix. |
| `localdb` | pglite running the real migrations, with a supabase-js-shaped client, for tests and local mode. |
| `cli`, `mcp`, `integrations` | Consumers of the above. |

## Rules that keep it honest

- **Routes only enqueue.** The worker is the only thing that clones and scans. Source is never persisted: the temp clone is deleted in `finally`.
- **Authorization is the database's job.** Routes read and write through the user's own client under row-level security. The service role is used for work the user may cause but not perform directly (queueing, audit).
- **One drawing.** Sheets are laid out once and drawn to screen, SVG and PDF from the same scene, in both themes, so what you inspect is what you export.
- **Evidence or it did not happen.** Every edge carries evidence (kind, file, line, snippet). Declared-only sources (`.env.example`) never create an edge. Dependency-only signals never create an entity edge.
- **Determinism.** The same repository state gives byte-identical graphs, hashes and PDFs.
- **Human decisions are data.** Scope membership, confirmations and hidden items are rows with an actor and a reason, replayed over every new scan; ones that no longer match are reported as orphaned.

## Local mode

`TRAILMAP_LOCAL=1` swaps three things behind the same interfaces: Supabase becomes pglite, GitHub becomes an in-memory store that "clones" from the bundled sample repository and scanner fixtures, and the worker runs on demand via `/api/local/run-worker`. The product code paths are the real ones, which is what lets the Playwright suite exercise onboarding, the PR check and acknowledgement end to end.

## Where to look

- Web data layer: `apps/web/lib/workspace/` (`load.ts`, `export.ts`, `scene.ts`, `inspect.ts`).
- Workspace UI: `apps/web/components/workspace/`.
- Migrations: `supabase/migrations/` (`003` hardening, `004` compliance layer).
- Tests: `supabase/tests` (isolation), `apps/web/app/api/*.test.ts` (routes), `e2e/` (browser).
