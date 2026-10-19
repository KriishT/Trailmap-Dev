# Architecture (current and target)

## Current
- `packages/scanner`: multi-pass scanner -> `DependencyGraph`.
- `packages/cli`, `packages/mcp`: consumers of the scanner.
- `apps/worker`: polls `scan_logs` and runs a scan job. `apps/web/lib/scan.ts` duplicates it.
- `apps/web`: Next.js App Router, Supabase auth, API routes, map UI.
- `supabase/migrations`: schema + RLS.

## Target
```
packages/
  scanner/      pure: dir -> deterministic graph (+ IaC, vendors, data classes)
  graph/        zod schema, graphSchemaVersion, hashing, diff, impact, drift rules
  pipeline/     clone -> scan -> classify -> snapshot -> diff -> drift (only executor)
  frameworks/   SOC 2 / PCI DSS / DORA mapping as JSON config
  cli/          scan | vendors | evidence | check
  mcp/          MCP tools over local graph or API-key cloud API
  ui/           design system ("survey sheet")
apps/
  web/          enqueue-only API, workspace UI, exports, share links
  worker/       claims jobs atomically (FOR UPDATE SKIP LOCKED), calls pipeline
supabase/migrations/   schema, RLS, audit_events append-only, api_keys hashed
```
Rules: routes only enqueue; the worker is the only scan executor; source code is never
persisted (temp clone deleted in `finally`); graph is validated on write and read.
