import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRepoAccess } from "@/lib/authz";
import { enqueueScan } from "@/lib/queue";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params;

  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;

  const { scanLogId, alreadyQueued } = await enqueueScan(supabaseAdmin(), repoId, "manual");
  return NextResponse.json({ ok: true, scanLogId, alreadyQueued });
}
