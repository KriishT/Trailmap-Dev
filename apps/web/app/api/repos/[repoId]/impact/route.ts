import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { computePrImpactForRepo } from "@/lib/github-pr-impact";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
