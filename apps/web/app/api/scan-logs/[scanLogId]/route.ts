import { NextResponse } from "next/server";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scanLogId: string }> }
) {
  const { scanLogId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: log, error } = await db
    .from("scan_logs")
    .select("id, status, error_message, snapshot_id, started_at, completed_at")
    .eq("id", scanLogId)
    .single();

  if (error || !log) {
    return NextResponse.json({ error: "Scan log not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, log });
}
