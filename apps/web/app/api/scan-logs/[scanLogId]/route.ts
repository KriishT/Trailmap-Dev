import { NextResponse } from "next/server";
import { requireUser, isUuid } from "@/lib/authz";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scanLogId: string }> }
) {
  const { scanLogId } = await params;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isUuid(scanLogId)) {
    return NextResponse.json({ error: "Scan log not found" }, { status: 404 });
  }

  // Runs as the user: row-level security only returns logs for repos in their orgs.
  const { data: log } = await auth.supabase
    .from("scan_logs")
    .select("id, status, error_message, snapshot_id, started_at, completed_at")
    .eq("id", scanLogId)
    .maybeSingle();

  if (!log) return NextResponse.json({ error: "Scan log not found" }, { status: 404 });
  return NextResponse.json({ ok: true, log });
}
