import { NextResponse } from "next/server";
import { requireRepoAccess } from "@/lib/authz";

const MAX_NODES = 500;

export function parseNodeIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_NODES) return null;
  if (!v.every((x) => typeof x === "string" && x.length > 0 && x.length < 300)) return null;
  return [...new Set(v as string[])].sort();
}

/** Create a compliance scope. Org owners and admins only (enforced by row-level security). */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const nodeIds = parseNodeIds(body?.nodeIds ?? []);
  if (!name || name.length > 80 || !nodeIds) return NextResponse.json({ error: "A name of up to 80 characters and a list of node ids are required" }, { status: 400 });
  const description = typeof body?.description === "string" ? body.description.slice(0, 300) : null;

  const { data: scope, error } = await access.supabase
    .from("scopes")
    .insert({ repo_id: repoId, name, description, created_by: access.user.id })
    .select("id")
    .single();
  if (error || !scope) {
    const duplicate = /duplicate|unique/i.test(error?.message ?? "");
    return NextResponse.json({ error: duplicate ? "A scope with that name already exists" : "Only organisation owners and admins can create scopes" }, { status: duplicate ? 409 : 403 });
  }
  for (const id of nodeIds) {
    await access.supabase.from("scope_members").insert({ scope_id: scope.id, node_id: id, added_by: access.user.id });
  }
  return NextResponse.json({ id: scope.id, name, nodeIds }, { status: 201 });
}
