import { NextResponse } from "next/server";
import { requireRepoAccess } from "@/lib/authz";
import { loadWorkspace } from "@/lib/workspace/load";
import { parseSceneRequest, renderSheet } from "@/lib/workspace/scene";

/** A laid-out sheet for the signed-in viewer, drawn in both themes. Body is JSON; `rev` picks a revision. */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  const body = await req.json().catch(() => null);
  const parsed = parseSceneRequest(body);
  if (!parsed) return NextResponse.json({ error: "Invalid sheet request" }, { status: 400 });
  const data = await loadWorkspace(access.supabase, repoId, { rev: typeof body?.rev === "string" ? body.rev : null });
  if (!data) return NextResponse.json({ error: "No readable snapshot for this repo yet" }, { status: 404 });
  return NextResponse.json(await renderSheet(data, parsed));
}
