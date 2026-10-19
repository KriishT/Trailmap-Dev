import { NextResponse } from "next/server";
import { parseStoredGraph, computeGraphHash } from "@trailmap/graph";
import { isUuid, requireRepoAccess } from "@/lib/authz";

/** Attest that a named person reviewed a snapshot's architecture. Bound to the snapshot's graph hash. */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  if (typeof body?.snapshotId !== "string" || !isUuid(body.snapshotId)) {
    return NextResponse.json({ error: "snapshotId required" }, { status: 400 });
  }
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;

  const { data: snap } = await access.supabase
    .from("graph_snapshots")
    .select("id, raw_json")
    .eq("id", body.snapshotId)
    .eq("repo_id", repoId)
    .maybeSingle();
  if (!snap) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

  let graphHash: string;
  try {
    const graph = parseStoredGraph(snap.raw_json);
    graphHash = graph.meta.graphHash ?? computeGraphHash(graph);
  } catch {
    return NextResponse.json({ error: "Snapshot is unreadable" }, { status: 422 });
  }

  const { data, error } = await access.supabase
    .from("attestations")
    .insert({
      repo_id: repoId, kind: "snapshot_review", graph_hash: graphHash, snapshot_id: snap.id,
      actor_user_id: access.user.id, actor_label: access.user.email ?? access.user.id, note,
    })
    .select("id, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not record the attestation" }, { status: 403 });
  return NextResponse.json({ id: data.id, graphHash, createdAt: data.created_at }, { status: 201 });
}
