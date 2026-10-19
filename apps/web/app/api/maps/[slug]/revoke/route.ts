import { NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase-server";
import { recordAudit } from "@/lib/audit";

/** Revoke a share link. Only its creator can; for anyone else it looks like a link that does not exist. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data } = await auth.supabase
    .from("shared_maps")
    .update({ revoked_at: new Date().toISOString() })
    .eq("slug", slug)
    .is("revoked_at", null)
    .select("id");
  if (!data || data.length === 0) return NextResponse.json({ error: "Link not found" }, { status: 404 });

  await recordAudit(supabaseAdmin(), { actorUserId: auth.user.id, action: "share_link.revoked", targetType: "shared_maps", targetId: data[0]!.id as string });
  return NextResponse.json({ ok: true });
}
