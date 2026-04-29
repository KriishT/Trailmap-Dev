import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { buildPrImpactComment, computePrImpactForRepo, upsertPrImpactComment } from "@/lib/github-pr-impact";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await parseBody(req);
  const prNumber = Number(body.prNumber);
  if (!Number.isFinite(prNumber)) {
    return NextResponse.json({ error: "Provide a valid PR number" }, { status: 400 });
  }

  const impact = await computePrImpactForRepo({ repoId, prNumber });
  if (!impact.ok) {
    return NextResponse.json({ error: impact.error }, { status: impact.status });
  }

  const commentBody = buildPrImpactComment({
    source: impact.source,
    snapshotCommit: impact.snapshotCommit,
    analysis: impact.analysis,
    trailmapUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    repoId,
  });

  const result = await upsertPrImpactComment({
    installationId: impact.installationId,
    fullName: impact.fullName,
    prNumber,
    body: commentBody,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    source: impact.source,
    updated: result.updated,
    commentId: result.commentId,
    analysis: impact.analysis,
  });
}

async function parseBody(req: Request): Promise<{ prNumber?: number }> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
