import type { SupabaseClient } from "@supabase/supabase-js";
import { applyOverrides, diffGraphs, edgeKey, parseStoredGraph, type DependencyGraph, type Override } from "@trailmap/graph";
import { VENDORS } from "@trailmap/scanner";
import { loadComplianceContext } from "@trailmap/pipeline/context";
import { revisionLabel, type AttestationView, type DriftView, type ExportView, type OverrideView, type RevisionInfo, type WorkspaceData } from "./types";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function summarizeChange(prev: DependencyGraph | null, next: DependencyGraph): string {
  if (!prev) return "Initial snapshot";
  const d = diffGraphs(prev, next);
  if (d.isEmpty) return "No architectural change";
  const parts: string[] = [];
  if (d.addedNodes.length) parts.push(`+${plural(d.addedNodes.length, "node")}`);
  if (d.removedNodes.length) parts.push(`-${plural(d.removedNodes.length, "node")}`);
  if (d.addedEdges.length) parts.push(`+${plural(d.addedEdges.length, "connection")}`);
  if (d.removedEdges.length) parts.push(`-${plural(d.removedEdges.length, "connection")}`);
  const exposed = d.changedNodes.filter((c) => c.fields.includes("exposure") || c.fields.includes("public")).length;
  if (exposed) parts.push(`${plural(exposed, "exposure change")}`);
  if (d.addedDataClasses.length) parts.push(`${plural(d.addedDataClasses.length, "data class flow")} added`);
  return parts.join(", ") || "Configuration changes";
}

function describeOverride(o: Override): string {
  switch (o.kind) {
    case "confirm_edge": return `Confirmed connection ${o.edgeId}`;
    case "hide_edge": return `Hid connection ${o.edgeId}`;
    case "hide_node": return `Hid ${o.nodeId}`;
    case "add_edge": return `Added ${o.edgeType} connection ${o.from} to ${o.to}`;
    case "set_data_class": return `${o.present ? "Marked" : "Cleared"} ${o.class} on ${o.target.id}`;
  }
}

export interface LoadOptions {
  /** A snapshot id, or an ISO date (YYYY-MM-DD) meaning "the snapshot effective on that date". */
  rev?: string | null;
  asOf?: string | null;
}

/**
 * Everything the repo workspace needs, read through the signed-in user's client so row-level
 * security decides what they may see. Returns null when the repo is not visible or has no usable snapshot.
 */
export async function loadWorkspace(db: SupabaseClient, repoId: string, opts: LoadOptions = {}): Promise<WorkspaceData | null> {
  const { data: repo } = await db.from("repos").select("id, full_name, default_branch, org_id").eq("id", repoId).maybeSingle();
  if (!repo) return null;

  const { data: snaps } = await db
    .from("graph_snapshots")
    .select("id, raw_json, scanned_at, commit_sha, node_count, edge_count")
    .eq("repo_id", repoId)
    .order("scanned_at", { ascending: true });
  const graphs: Array<{ row: NonNullable<typeof snaps>[number]; graph: DependencyGraph }> = [];
  for (const row of snaps ?? []) {
    try {
      graphs.push({ row, graph: parseStoredGraph(row.raw_json) });
    } catch {
      /* skip unreadable snapshots */
    }
  }
  if (graphs.length === 0) return null;

  const ctx = await loadComplianceContext(db, repoId);

  const revisions: RevisionInfo[] = graphs.map(({ row, graph }, i) => ({
    id: row.id as string,
    label: revisionLabel(i),
    scannedAt: row.scanned_at as string,
    commitSha: (row.commit_sha as string | null) ?? null,
    graphHash: graph.meta.graphHash ?? null,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    summary: summarizeChange(i > 0 ? graphs[i - 1]!.graph : null, graph),
  }));

  let index = graphs.length - 1;
  if (opts.rev) {
    const byId = graphs.findIndex((g) => g.row.id === opts.rev);
    if (byId !== -1) index = byId;
  } else if (opts.asOf) {
    // The snapshot in force on a date is the latest one taken on or before the end of that day.
    const end = new Date(`${opts.asOf}T23:59:59.999Z`).getTime();
    let hit = -1;
    graphs.forEach((g, i) => { if (new Date(g.row.scanned_at as string).getTime() <= end) hit = i; });
    index = hit === -1 ? 0 : hit;
  }
  const selected = graphs[index]!;
  const previous = index > 0 ? graphs[index - 1]!.graph : null;

  const effective = applyOverrides(selected.graph, ctx.overrides);
  const diff = previous ? diffGraphs(previous, selected.graph) : null;
  const highlightNodeIds = diff ? [...diff.addedNodes.map((n) => n.id), ...diff.changedNodes.map((c) => c.id)] : [];
  const highlightEdgeIds = diff ? diff.addedEdges.map(edgeKey) : [];

  const [{ data: ovRows }, { data: users }] = await Promise.all([
    db.from("graph_overrides").select("id, kind, reason, actor_id, created_at").eq("repo_id", repoId).is("revoked_at", null).order("created_at", { ascending: true }),
    db.from("users").select("id, email"),
  ]);
  const emailOf = new Map((users ?? []).map((u) => [u.id as string, u.email as string]));
  const applied = new Map(ctx.overrides.map((o) => [o.id, o]));
  const overrides: OverrideView[] = (ovRows ?? []).map((r) => ({
    id: r.id as string, kind: r.kind as Override["kind"], reason: r.reason as string,
    actor: emailOf.get(r.actor_id as string) ?? (r.actor_id as string), createdAt: r.created_at as string,
    summary: applied.get(r.id as string) ? describeOverride(applied.get(r.id as string)!) : String(r.kind),
  }));

  const [{ data: vendorRows }, { data: attRows }, { data: driftRows }, { data: exportRows }, { data: policyRow }, { data: activeRows }] = await Promise.all([
    db.from("vendors").select("vendor_id, purpose, region, dpa_on_file, notes").eq("org_id", repo.org_id),
    db.from("attestations").select("id, kind, actor_label, note, graph_hash, created_at").eq("repo_id", repoId).order("created_at", { ascending: false }).limit(50),
    db.from("drift_events").select("id, pr_number, head_sha, conclusion, status, summary, findings, acknowledged_by, created_at").eq("repo_id", repoId).order("created_at", { ascending: false }).limit(20),
    db.from("exports").select("id, framework, format, graph_hash, file_hash, period_start, period_end, created_at").eq("repo_id", repoId).order("created_at", { ascending: false }).limit(50),
    db.from("repo_policies").select("config").eq("repo_id", repoId).maybeSingle(),
    db.from("scan_logs").select("id, status").eq("repo_id", repoId).in("status", ["pending", "running"]).eq("kind", "scan").order("created_at", { ascending: false }).limit(1),
  ]);
  const { data: canAdmin } = await db.rpc("can_admin_repo", { p_repo: repoId });

  const cfg = (policyRow?.config ?? {}) as { frameworks?: string[]; on_drift?: "neutral" | "failure" };
  return {
    repo: { id: repo.id as string, fullName: repo.full_name as string, defaultBranch: repo.default_branch as string },
    demo: false,
    revisions,
    selectedId: selected.row.id as string,
    graph: selected.graph,
    effective: effective.graph,
    highlightNodeIds, highlightEdgeIds,
    scopes: ctx.scopes,
    overrides,
    orphanedOverrides: effective.orphaned.length,
    vendorMeta: (vendorRows ?? []).map((v) => ({
      vendorId: v.vendor_id as string, purpose: (v.purpose as string) ?? undefined, region: (v.region as string) ?? undefined,
      dpaOnFile: (v.dpa_on_file as boolean | null) ?? undefined, notes: (v.notes as string) ?? undefined,
    })),
    catalog: VENDORS.map((v) => ({ id: v.id, name: v.name, category: v.category, website: v.website })),
    attestations: (attRows ?? []).map((a): AttestationView => ({ id: a.id as string, kind: a.kind as AttestationView["kind"], actor: a.actor_label as string, note: (a.note as string | null) ?? null, graphHash: a.graph_hash as string, createdAt: a.created_at as string })),
    drift: (driftRows ?? []).map((d): DriftView => ({
      id: d.id as string, prNumber: d.pr_number as number, headSha: d.head_sha as string, conclusion: d.conclusion as DriftView["conclusion"],
      status: d.status as DriftView["status"], summary: d.summary as string, findings: (d.findings as DriftView["findings"]) ?? [],
      acknowledgedBy: (d.acknowledged_by as string | null) ?? null, createdAt: d.created_at as string,
    })),
    exports: (exportRows ?? []).map((e): ExportView => ({ id: e.id as string, framework: e.framework as string, format: e.format as string, graphHash: e.graph_hash as string, fileHash: e.file_hash as string, periodStart: (e.period_start as string | null) ?? null, periodEnd: (e.period_end as string | null) ?? null, createdAt: e.created_at as string })),
    policy: { frameworks: cfg.frameworks ?? [], onDrift: cfg.on_drift ?? "neutral" },
    permissions: { canAdmin: canAdmin === true },
    activeScan: activeRows?.[0] ? { id: activeRows[0].id as string, status: activeRows[0].status as string } : null,
  };
}
