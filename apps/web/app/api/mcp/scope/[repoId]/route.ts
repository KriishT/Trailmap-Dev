import { NextResponse } from "next/server";
import { analyzeScope } from "@trailmap/graph";
import { supabaseAdmin } from "@/lib/supabase-server";
import { authenticateApiKey, repoForKey } from "@/lib/api-keys";
import { isUuid } from "@/lib/authz";
import { loadRepoGraph } from "@/lib/graph-store";

/** Compliance scopes for a repo with their members, boundary crossings and connected-to sets. */
export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const admin = supabaseAdmin();
  const auth = await authenticateApiKey(req, admin);
  if (!auth.ok) return auth.response;
  const repo = isUuid(repoId) ? await repoForKey(admin, auth, repoId) : null;
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const g = await loadRepoGraph(admin, repo.id);
  if (!g) return NextResponse.json({ error: "No readable snapshot for this repo yet" }, { status: 404 });

  const scopes = g.scopes.map((scope) => {
    const a = analyzeScope(g.effective, scope);
    return {
      id: scope.id,
      name: scope.name,
      members: a.members.map((n) => ({ id: n.id, name: n.name, type: n.type })),
      missing: a.missing,
      connectedTo: a.connectedTo.map((n) => ({ id: n.id, name: n.name, type: n.type })),
      crossings: a.crossings.map((c) => ({
        edgeId: c.edge.id, direction: c.direction, inside: c.inside.id, outside: c.outside.id,
        type: c.edge.type, confidence: c.edge.confidence,
      })),
    };
  });
  return NextResponse.json({ repo: { id: repo.id, fullName: repo.full_name }, snapshot: g.snapshot, scopes });
}
