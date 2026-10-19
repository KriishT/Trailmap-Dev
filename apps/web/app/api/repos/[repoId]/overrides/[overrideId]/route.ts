import { NextResponse } from "next/server";
import { isUuid, requireRepoAccess } from "@/lib/authz";

/** Undo a decision. The row stays (marked revoked) so the history shows it was made and withdrawn. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ repoId: string; overrideId: string }> }) {
  const { repoId, overrideId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  if (!isUuid(overrideId)) return NextResponse.json({ error: "Decision not found" }, { status: 404 });

  const { data } = await access.supabase
    .from("graph_overrides")
    .update({ revoked_at: new Date().toISOString(), revoked_by: access.user.id })
    .eq("id", overrideId)
    .eq("repo_id", repoId)
    .is("revoked_at", null)
    .select("id");
  if (!data?.length) return NextResponse.json({ error: "Decision not found or you may not undo it" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
