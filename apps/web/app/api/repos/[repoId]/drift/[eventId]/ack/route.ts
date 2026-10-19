import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isUuid, requireRepoAccess } from "@/lib/authz";
import { enqueuePrRecheck } from "@/lib/queue";

/**
 * Acknowledge the drift reported on a pull request. Records an attestation by the signed-in
 * person, bound to the exact graph that was reported, then queues a re-check that turns the
 * GitHub check green. Pushing new commits needs a new acknowledgement.
 */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string; eventId: string }> }) {
  const { repoId, eventId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  if (!isUuid(eventId)) return NextResponse.json({ error: "Drift event not found" }, { status: 404 });

  const { data: event } = await access.supabase
    .from("drift_events")
    .select("id, status, head_graph_hash")
    .eq("id", eventId)
    .eq("repo_id", repoId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "Drift event not found" }, { status: 404 });
  if (event.status === "acknowledged") return NextResponse.json({ ok: true, alreadyAcknowledged: true });

  const body = await req.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;

  // Inserted as the user: row-level security requires membership and that the actor is the caller.
  const { error } = await access.supabase.from("attestations").insert({
    repo_id: repoId,
    kind: "drift_ack",
    graph_hash: event.head_graph_hash,
    drift_event_id: eventId,
    actor_user_id: access.user.id,
    actor_label: access.user.email ?? access.user.id,
    note,
  });
  if (error) return NextResponse.json({ error: "Could not record the acknowledgement" }, { status: 403 });

  await enqueuePrRecheck(supabaseAdmin(), repoId, eventId);
  return NextResponse.json({ ok: true }, { status: 202 });
}
