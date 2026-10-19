import { NextResponse } from "next/server";
import { requireRepoAccess } from "@/lib/authz";

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Record what code cannot tell us about a vendor: its purpose, data region and whether a DPA is on file. */
export async function PUT(req: Request, { params }: { params: Promise<{ repoId: string; vendorId: string }> }) {
  const { repoId, vendorId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  if (!/^[\w.:-]{1,120}$/.test(vendorId)) return NextResponse.json({ error: "Invalid vendor id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const dpa = body?.dpaOnFile === true ? true : body?.dpaOnFile === false ? false : null;
  const { data, error } = await access.supabase
    .from("vendors")
    .upsert(
      { org_id: access.repo.org_id, vendor_id: vendorId, purpose: clip(body?.purpose, 200), region: clip(body?.region, 60), dpa_on_file: dpa, notes: clip(body?.notes, 500), source: "manual", updated_by: access.user.id },
      { onConflict: "org_id,vendor_id" }
    )
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "Only organisation owners and admins can edit vendor records" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
