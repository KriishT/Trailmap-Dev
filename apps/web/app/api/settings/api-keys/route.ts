import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isUuid, requireUser } from "@/lib/authz";
import { generateApiKey } from "@/lib/api-keys";
import { recordAudit } from "@/lib/audit";

/** List the API keys of an organisation. Only org owners and admins can see them; for anyone else the list is empty. */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const orgId = new URL(req.url).searchParams.get("orgId") ?? "";
  if (!isUuid(orgId)) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const { data } = await auth.supabase
    .from("api_keys")
    .select("id, name, prefix, created_at, last_used_at, revoked_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  return NextResponse.json({ keys: data ?? [] });
}

/** Create a key. The full key is in this response only; afterwards only its prefix can be shown. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!isUuid(orgId) || !name || name.length > 80) {
    return NextResponse.json({ error: "orgId and a name of up to 80 characters are required" }, { status: 400 });
  }

  const { data: isAdmin } = await auth.supabase.rpc("is_org_admin", { org: orgId });
  if (!isAdmin) return NextResponse.json({ error: "Only organisation owners and admins can create API keys" }, { status: 403 });

  const admin = supabaseAdmin();
  const { key, prefix, hash } = generateApiKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({ org_id: orgId, name, prefix, key_hash: hash, created_by: auth.user.id })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not create the key" }, { status: 500 });

  await recordAudit(admin, { orgId, actorUserId: auth.user.id, action: "api_key.created", targetType: "api_keys", targetId: data.id, metadata: { name, prefix } });
  return NextResponse.json({ id: data.id, name, prefix, key }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
