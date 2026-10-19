import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { authenticateApiKey, repoForKey } from "@/lib/api-keys";
import { isUuid } from "@/lib/authz";
import { loadRepoGraph } from "@/lib/graph-store";
import { createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter(120, 60_000);

/** The latest architecture graph for a repo, for the MCP server and other tools. Bearer API key required. */
export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const admin = supabaseAdmin();
  const auth = await authenticateApiKey(req, admin);
  if (!auth.ok) return auth.response;
  if (!limiter.take(auth.keyId)) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": "60" } });

  const repo = isUuid(repoId) ? await repoForKey(admin, auth, repoId) : null;
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const g = await loadRepoGraph(admin, repo.id);
  if (!g) return NextResponse.json({ error: "No readable snapshot for this repo yet" }, { status: 404 });

  return NextResponse.json({
    repo: { id: repo.id, fullName: repo.full_name },
    snapshot: g.snapshot,
    graph: g.effective,
    scopes: g.scopes,
    orphanedOverrides: g.orphanedOverrides.length,
  });
}
