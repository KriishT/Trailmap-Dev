import { NextResponse } from "next/server";
import { isUuid, requireRepoAccess } from "@/lib/authz";

const MAX_NODES = 500;
const parseIds = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= MAX_NODES && v.every((x) => typeof x === "string" && x.length > 0 && x.length < 300) ? [...new Set(v as string[])].sort() : null;

/** Rename a scope and/or replace its members. Membership changes are audited by database triggers. */
export async function PUT(req: Request, { params }: { params: Promise<{ repoId: string; scopeId: string }> }) {
  const { repoId, scopeId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  if (!isUuid(scopeId)) return NextResponse.json({ error: "Scope not found" }, { status: 404 });

  const { data: scope } = await access.supabase.from("scopes").select("id").eq("id", scopeId).eq("repo_id", repoId).maybeSingle();
  if (!scope) return NextResponse.json({ error: "Scope not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return NextResponse.json({ error: "Name must be 1 to 80 characters" }, { status: 400 });
    const { data, error } = await access.supabase.from("scopes").update({ name }).eq("id", scopeId).select("id");
    if (error || !data?.length) return NextResponse.json({ error: "Could not rename the scope" }, { status: 403 });
  }
  if (body?.nodeIds !== undefined) {
    const wanted = parseIds(body.nodeIds);
    if (!wanted) return NextResponse.json({ error: "nodeIds must be a list of node ids" }, { status: 400 });
    const { data: current } = await access.supabase.from("scope_members").select("node_id").eq("scope_id", scopeId);
    const have = new Set((current ?? []).map((m) => m.node_id as string));
    for (const id of wanted.filter((x) => !have.has(x))) {
      const { error } = await access.supabase.from("scope_members").insert({ scope_id: scopeId, node_id: id, added_by: access.user.id });
      if (error) return NextResponse.json({ error: "Only organisation owners and admins can change scopes" }, { status: 403 });
    }
    for (const id of [...have].filter((x) => !wanted.includes(x))) {
      // Row-level security hides rows from non-admins instead of erroring, so check something was removed.
      const { data: removed } = await access.supabase.from("scope_members").delete().eq("scope_id", scopeId).eq("node_id", id).select("node_id");
      if (!removed?.length) return NextResponse.json({ error: "Only organisation owners and admins can change scopes" }, { status: 403 });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ repoId: string; scopeId: string }> }) {
  const { repoId, scopeId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  if (!isUuid(scopeId)) return NextResponse.json({ error: "Scope not found" }, { status: 404 });
  const { data } = await access.supabase.from("scopes").delete().eq("id", scopeId).eq("repo_id", repoId).select("id");
  if (!data?.length) return NextResponse.json({ error: "Scope not found or you may not delete it" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
