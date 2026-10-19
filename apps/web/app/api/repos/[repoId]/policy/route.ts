import { NextResponse } from "next/server";
import { listFrameworks } from "@trailmap/frameworks";
import { requireRepoAccess } from "@/lib/authz";

const KNOWN = new Set(listFrameworks().map((f) => f.id));

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  const { data } = await access.supabase.from("repo_policies").select("config").eq("repo_id", repoId).maybeSingle();
  return NextResponse.json({ config: data?.config ?? {} });
}

/** Settings made in the app. They override `.trailmap.yml` field by field when a pull request is checked. */
export async function PUT(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const config: Record<string, unknown> = {};
  if (body?.frameworks !== undefined) {
    if (!Array.isArray(body.frameworks) || !body.frameworks.every((f: unknown) => typeof f === "string" && KNOWN.has(f))) {
      return NextResponse.json({ error: `frameworks must be a list of: ${[...KNOWN].join(", ")}` }, { status: 400 });
    }
    config.frameworks = [...new Set(body.frameworks as string[])];
  }
  if (body?.on_drift !== undefined) {
    if (body.on_drift !== "neutral" && body.on_drift !== "failure") return NextResponse.json({ error: "on_drift must be neutral or failure" }, { status: 400 });
    config.on_drift = body.on_drift;
  }
  if (body?.ignore !== undefined) {
    if (!Array.isArray(body.ignore) || !body.ignore.every((x: unknown) => typeof x === "string" && x.length < 300)) return NextResponse.json({ error: "ignore must be a list of strings" }, { status: 400 });
    config.ignore = body.ignore;
  }

  const { data: existing } = await access.supabase.from("repo_policies").select("config").eq("repo_id", repoId).maybeSingle();
  const merged = { ...((existing?.config as object | undefined) ?? {}), ...config };
  const { error } = await access.supabase
    .from("repo_policies")
    .upsert({ repo_id: repoId, config: merged, updated_by: access.user.id }, { onConflict: "repo_id" });
  if (error) return NextResponse.json({ error: "Only organisation owners and admins can change policy" }, { status: 403 });
  return NextResponse.json({ ok: true, config: merged });
}
