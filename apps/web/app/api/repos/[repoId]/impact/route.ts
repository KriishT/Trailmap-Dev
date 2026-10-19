import { NextRequest, NextResponse } from "next/server";
import { requireRepoAccess } from "@/lib/authz";
import { computePrImpactForRepo } from "@/lib/github-pr-impact";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params;

  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;

  const prRaw = req.nextUrl.searchParams.get("pr");
  const base = req.nextUrl.searchParams.get("base");
  const head = req.nextUrl.searchParams.get("head");
  const parsedPrNumber = prRaw ? Number(prRaw) : null;

  const impact = await computePrImpactForRepo({
    repoId,
    prNumber: typeof parsedPrNumber === "number" && Number.isFinite(parsedPrNumber) ? parsedPrNumber : null,
    base,
    head,
  });

  if (!impact.ok) {
    return NextResponse.json({ error: impact.error }, { status: impact.status });
  }

  return NextResponse.json({
    ok: true,
    repo: impact.fullName,
    snapshotId: impact.snapshotId,
    snapshotCommit: impact.snapshotCommit,
    source: impact.source,
    analysis: impact.analysis,
  });
}
