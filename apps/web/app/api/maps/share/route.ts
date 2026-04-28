import { NextResponse } from "next/server";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { snapshotId } = await req.json();
  if (!snapshotId) return NextResponse.json({ error: "snapshotId required" }, { status: 400 });

  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("shared_maps")
    .select("slug")
    .eq("snapshot_id", snapshotId)
    .eq("created_by", user.id)
    .single();

  if (existing) return NextResponse.json({ slug: existing.slug });

  const slug = nanoid(10);
  const { data, error } = await db
    .from("shared_maps")
    .insert({ snapshot_id: snapshotId, slug, created_by: user.id })
    .select("slug")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ slug: data.slug });
}

