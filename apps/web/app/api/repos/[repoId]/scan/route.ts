import { NextResponse } from "next/server";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { scanRepo } from "@/lib/scan";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: repo } = await db.from("repos").select("id").eq("id", repoId).single();
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const { data: log } = await db
    .from("scan_logs")
    .insert({ repo_id: repoId, triggered_by: "manual", status: "pending" })
    .select("id")
    .single();

  if (log) {
    scanRepo(repoId, log.id).catch(console.error);
  }

  return NextResponse.json({ ok: true, scanLogId: log?.id });
}