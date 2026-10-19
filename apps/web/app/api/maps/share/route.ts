import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { requireUser, isUuid } from "@/lib/authz";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await req.json().catch(() => ({}));
  const snapshotId = body?.snapshotId;
  if (typeof snapshotId !== "string" || !isUuid(snapshotId)) {
    return NextResponse.json({ error: "snapshotId required" }, { status: 400 });
  }

  // Both lookups run as the user, so row-level security limits them to their own orgs.
  const { data: snapshot } = await supabase
    .from("graph_snapshots")
    .select("id")
    .eq("id", snapshotId)
    .maybeSingle();
  if (!snapshot) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

  const { data: existing } = await supabase
    .from("shared_maps")
    .select("slug")
    .eq("snapshot_id", snapshotId)
    .eq("created_by", user.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ slug: existing.slug });

  const slug = nanoid(10);
  const { data, error } = await supabase
    .from("shared_maps")
    .insert({ snapshot_id: snapshotId, slug, created_by: user.id })
    .select("slug")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to share" }, { status: 500 });
  }
  return NextResponse.json({ slug: data.slug });
}
