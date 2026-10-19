import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { requireUser, isUuid } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/share";
import { recordAudit } from "@/lib/audit";

/**
 * Create a read-only share link for a snapshot. Private by default in the sense that nothing is
 * listed or guessable: the slug is random, links can expire, require a password, carry a watermark
 * label for the recipient, and can be revoked.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await req.json().catch(() => ({}));
  const snapshotId = body?.snapshotId;
  if (typeof snapshotId !== "string" || !isUuid(snapshotId)) {
    return NextResponse.json({ error: "snapshotId required" }, { status: 400 });
  }
  const password = typeof body?.password === "string" && body.password ? body.password : null;
  if (password && (password.length < MIN_PASSWORD_LENGTH || password.length > 200)) {
    return NextResponse.json({ error: `Password must be ${MIN_PASSWORD_LENGTH} to 200 characters` }, { status: 400 });
  }
  const days = body?.expiresInDays === undefined || body.expiresInDays === null ? null : Number(body.expiresInDays);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
    return NextResponse.json({ error: "expiresInDays must be a whole number from 1 to 365" }, { status: 400 });
  }
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null;

  // Runs as the user, so row-level security limits this to snapshots in their own orgs.
  const { data: snapshot } = await supabase.from("graph_snapshots").select("id, repo_id").eq("id", snapshotId).maybeSingle();
  if (!snapshot) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

  const plain = !password && !label && days === null;
  if (plain) {
    const { data: existing } = await supabase
      .from("shared_maps")
      .select("slug, expires_at, revoked_at")
      .eq("snapshot_id", snapshotId)
      .eq("created_by", user.id)
      .is("revoked_at", null)
      .is("expires_at", null)
      .limit(1)
      .maybeSingle();
    if (existing) return NextResponse.json({ slug: existing.slug });
  }

  const admin = supabaseAdmin();
  const slug = nanoid(16);
  const { data, error } = await admin
    .from("shared_maps")
    .insert({
      snapshot_id: snapshotId, slug, created_by: user.id, label,
      password_hash: password ? await hashPassword(password) : null,
      expires_at: days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
    })
    .select("id, slug, expires_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not create the link" }, { status: 500 });

  await recordAudit(admin, {
    repoId: snapshot.repo_id as string, actorUserId: user.id, action: "share_link.created", targetType: "shared_maps", targetId: data.id,
    metadata: { passwordProtected: Boolean(password), expiresAt: data.expires_at, label },
  });
  return NextResponse.json({ slug: data.slug, expiresAt: data.expires_at, passwordProtected: Boolean(password), label });
}
