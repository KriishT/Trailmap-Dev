import { NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";

/** Who looked at a share link and when. Only the link's creator can read it. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data: link } = await auth.supabase.from("shared_maps").select("id, slug, label, expires_at, revoked_at, created_at").eq("slug", slug).maybeSingle();
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 });

  const { data: entries } = await auth.supabase
    .from("shared_map_access")
    .select("accessed_at, outcome, ip_hash, user_agent")
    .eq("shared_map_id", link.id)
    .order("accessed_at", { ascending: false })
    .limit(200);
  return NextResponse.json({ link, entries: entries ?? [] });
}
