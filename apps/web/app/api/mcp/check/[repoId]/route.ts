import { NextResponse } from "next/server";
import { analyzeChangedFiles } from "@trailmap/graph";
import { supabaseAdmin } from "@/lib/supabase-server";
import { authenticateApiKey, repoForKey } from "@/lib/api-keys";
import { isUuid } from "@/lib/authz";
import { loadRepoGraph } from "@/lib/graph-store";

const MAX_FILES = 500;

/** What would a change to these files touch? Which services, owners' scopes, vendors and datastores. */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const admin = supabaseAdmin();
  const auth = await authenticateApiKey(req, admin);
  if (!auth.ok) return auth.response;
  const repo = isUuid(repoId) ? await repoForKey(admin, auth, repoId) : null;
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const files: unknown = body?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES || !files.every((f) => typeof f === "string" && f.length < 500)) {
    return NextResponse.json({ error: `files must be a list of 1 to ${MAX_FILES} paths` }, { status: 400 });
  }

  const g = await loadRepoGraph(admin, repo.id);
  if (!g) return NextResponse.json({ error: "No readable snapshot for this repo yet" }, { status: 404 });

  const impact = analyzeChangedFiles(g.effective, files as string[]);
  const touchedIds = new Set(impact.touched.map((t) => t.id));
  const scopesTouched = g.scopes.filter((s) => s.nodeIds.some((id) => touchedIds.has(id))).map((s) => ({ id: s.id, name: s.name }));
  return NextResponse.json({ snapshot: g.snapshot, impact, scopesTouched });
}
