import type { SupabaseClient } from "@supabase/supabase-js";
import { applyOverrides, parseStoredGraph, type DependencyGraph, type Override, type Scope } from "@trailmap/graph";
import { loadComplianceContext } from "@trailmap/pipeline/context";

export interface SnapshotInfo {
  id: string;
  scannedAt: string;
  commitSha: string | null;
  branch: string | null;
  graphHash: string | null;
}

export interface RepoGraph {
  snapshot: SnapshotInfo;
  /** Scanner output exactly as stored. This is what attestations are bound to. */
  base: DependencyGraph;
  /** Scanner output with human decisions (confirmed, hidden, added) applied. What people see and export. */
  effective: DependencyGraph;
  scopes: Scope[];
  overrides: Override[];
  orphanedOverrides: Override[];
}

/** The latest snapshot of a repo with its compliance context. Returns null if nothing has been scanned or the graph is unreadable. */
export async function loadRepoGraph(db: SupabaseClient, repoId: string, snapshotId?: string): Promise<RepoGraph | null> {
  let query = db.from("graph_snapshots").select("id, raw_json, scanned_at, commit_sha, branch").eq("repo_id", repoId);
  if (snapshotId) query = query.eq("id", snapshotId);
  const { data: row } = await query.order("scanned_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) return null;

  let base: DependencyGraph;
  try {
    base = parseStoredGraph(row.raw_json);
  } catch {
    return null;
  }
  const ctx = await loadComplianceContext(db, repoId);
  const applied = applyOverrides(base, ctx.overrides);
  return {
    snapshot: {
      id: row.id as string,
      scannedAt: row.scanned_at as string,
      commitSha: (row.commit_sha as string | null) ?? null,
      branch: (row.branch as string | null) ?? null,
      graphHash: base.meta.graphHash ?? null,
    },
    base,
    effective: applied.graph,
    scopes: ctx.scopes,
    overrides: ctx.overrides,
    orphanedOverrides: applied.orphaned,
  };
}
