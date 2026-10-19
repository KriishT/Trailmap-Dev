import { NextResponse } from "next/server";
import {
  applyOverrides, driftFingerprint, evaluateDrift, parseStoredGraph, prepareGraphForWrite, type DependencyGraph,
} from "@trailmap/graph";
import { resolvePolicy, scopesFromPolicy } from "@trailmap/pipeline/context";
import { supabaseAdmin } from "@/lib/supabase-server";
import { authenticateApiKey, repoForKey } from "@/lib/api-keys";
import { isUuid } from "@/lib/authz";
import { loadRepoGraph } from "@/lib/graph-store";
import { recordAudit } from "@/lib/audit";
import { createRateLimiter } from "@/lib/rate-limit";

const MAX_BYTES = 10 * 1024 * 1024;
const limiter = createRateLimiter(30, 60_000);

/**
 * CI-only mode: the pipeline scans the code itself and uploads only the graph, so Trailmap never
 * needs access to the repository. Without `pr` the graph is stored as a snapshot. With `pr` it is
 * compared with the latest snapshot and the drift verdict is returned for the CI job to act on.
 */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const admin = supabaseAdmin();
  const auth = await authenticateApiKey(req, admin);
  if (!auth.ok) return auth.response;
  if (!limiter.take(auth.keyId)) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": "60" } });

  const repo = isUuid(repoId) ? await repoForKey(admin, auth, repoId) : null;
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return NextResponse.json({ error: "Graph is too large (limit 10 MB)" }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Graph is too large (limit 10 MB)" }, { status: 413 });

  let body: { graph?: unknown; commitSha?: unknown; branch?: unknown; pr?: { number?: unknown; headSha?: unknown }; policy?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  let graph: DependencyGraph;
  try {
    graph = prepareGraphForWrite(body.graph);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid graph" }, { status: 422 });
  }
  const commitSha = typeof body.commitSha === "string" ? body.commitSha.slice(0, 64) : null;
  const branch = typeof body.branch === "string" ? body.branch.slice(0, 200) : repo.default_branch;

  if (!body.pr) {
    const { data, error } = await admin
      .from("graph_snapshots")
      .insert({
        repo_id: repo.id, node_count: graph.nodes.length, edge_count: graph.edges.length,
        total_files: graph.meta.total_files, language_breakdown: graph.meta.language_breakdown,
        raw_json: graph, commit_sha: commitSha, branch,
      })
      .select("id")
      .single();
    if (error || !data) return NextResponse.json({ error: "Could not store the snapshot" }, { status: 500 });
    await admin.from("repos").update({ last_scanned_at: new Date().toISOString() }).eq("id", repo.id);
    await recordAudit(admin, { orgId: repo.org_id, repoId: repo.id, actorType: "api_key", action: "snapshot.uploaded", targetType: "graph_snapshots", targetId: data.id, metadata: { keyId: auth.keyId, graphHash: graph.meta.graphHash } });
    return NextResponse.json({ snapshotId: data.id, graphHash: graph.meta.graphHash }, { status: 201 });
  }

  const prNumber = Number(body.pr.number);
  const headSha = typeof body.pr.headSha === "string" ? body.pr.headSha.slice(0, 64) : "";
  if (!Number.isInteger(prNumber) || prNumber <= 0 || !headSha) {
    return NextResponse.json({ error: "pr.number and pr.headSha are required" }, { status: 400 });
  }

  const baseline = await loadRepoGraph(admin, repo.id);
  const { policy, errors } = resolvePolicy(typeof body.policy === "string" ? body.policy : null, null);
  if (!baseline) {
    return NextResponse.json({ conclusion: "neutral", summary: "No baseline snapshot to compare against.", findings: [], policyErrors: errors });
  }
  const head = applyOverrides(graph, baseline.overrides).graph;
  const base = applyOverrides(parseStoredGraph(baseline.base), baseline.overrides).graph;
  const drift = evaluateDrift({ base, head, scopes: [...baseline.scopes, ...scopesFromPolicy(policy)], policy });

  const { data: saved } = await admin
    .from("drift_events")
    .upsert(
      {
        repo_id: repo.id, pr_number: prNumber, head_sha: headSha, base_snapshot_id: baseline.snapshot.id,
        head_graph_hash: graph.meta.graphHash ?? "", findings: drift.findings, ignored: drift.ignored,
        fingerprint: driftFingerprint(drift.findings), summary: drift.summary, policy_errors: errors,
        conclusion: drift.conclusion, status: "open",
      },
      { onConflict: "repo_id,pr_number,head_sha" }
    )
    .select("id")
    .single();
  return NextResponse.json({
    driftEventId: saved?.id ?? null, conclusion: drift.conclusion, summary: drift.summary,
    findings: drift.findings, ignored: drift.ignored.length, policyErrors: errors,
  });
}
