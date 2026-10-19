import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isUuid, requireUser } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

/** Revoke a key. Visible only to the org's admins, so anyone else gets 404. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const { keyId } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isUuid(keyId)) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  const { data: key } = await auth.supabase.from("api_keys").select("id, org_id, name, revoked_at").eq("id", keyId).maybeSingle();
  if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  if (key.revoked_at) return NextResponse.json({ ok: true, alreadyRevoked: true });

  const admin = supabaseAdmin();
  const { error } = await admin.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId);
  if (error) return NextResponse.json({ error: "Could not revoke the key" }, { status: 500 });
  await recordAudit(admin, { orgId: key.org_id as string, actorUserId: auth.user.id, action: "api_key.revoked", targetType: "api_keys", targetId: keyId, metadata: { name: key.name } });
  return NextResponse.json({ ok: true });
}
