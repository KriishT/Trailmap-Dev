import { NextResponse, type NextRequest } from "next/server";
import { requireRepoAccess } from "@/lib/authz";
import { loadWorkspace } from "@/lib/workspace/load";
import { buildExport, isIsoDate, type ExportFormat } from "@/lib/workspace/export";
import { supabaseAdmin } from "@/lib/supabase-server";
import { recordAudit } from "@/lib/audit";
import type { SheetKind } from "@trailmap/sheets";

const FORMATS = new Set<ExportFormat>(["pdf", "svg", "json", "csv", "pack"]);
const SHEETS = new Set<SheetKind>(["system", "data-flow", "network"]);

/**
 * Download an evidence export. Every export is recorded with the hash of the file and of the
 * graph it was made from, so a file in an assessor's hands can be matched to this record.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;
  const q = req.nextUrl.searchParams;

  const format = (q.get("format") ?? "pdf") as ExportFormat;
  const sheet = (q.get("sheet") ?? "system") as SheetKind;
  if (!FORMATS.has(format) || !SHEETS.has(sheet)) return NextResponse.json({ error: "Unknown format or sheet" }, { status: 400 });
  const start = q.get("periodStart");
  const end = q.get("periodEnd");
  if ((start || end) && (!isIsoDate(start) || !isIsoDate(end) || start > end)) {
    return NextResponse.json({ error: "periodStart and periodEnd must be dates (YYYY-MM-DD) with start before end" }, { status: 400 });
  }

  const data = await loadWorkspace(access.supabase, repoId, { rev: q.get("rev") });
  if (!data) return NextResponse.json({ error: "No readable snapshot for this repo yet" }, { status: 404 });

  let result;
  try {
    result = await buildExport(data, {
      format, framework: q.get("framework") ?? "pci", sheet, theme: q.get("theme") === "dark" ? "dark" : "light",
      period: start && end ? { start, end } : null, preparedBy: access.user.email ?? access.user.id,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Export failed" }, { status: 400 });
  }

  const { error } = await access.supabase.from("exports").insert({
    repo_id: repoId, snapshot_id: data.selectedId, graph_hash: result.graphHash, framework: result.frameworkId,
    format, file_hash: result.fileHash, period_start: start, period_end: end, prepared_by: access.user.id,
  });
  if (error) return NextResponse.json({ error: "Could not record the export" }, { status: 500 });
  await recordAudit(supabaseAdmin(), { orgId: access.repo.org_id, repoId, actorUserId: access.user.id, action: "export.downloaded", targetType: "exports", metadata: { format, framework: result.frameworkId, fileHash: result.fileHash } });

  return new NextResponse(Buffer.from(result.bytes), {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
      "X-Trailmap-Graph-Hash": result.graphHash,
      "X-Trailmap-File-Hash": result.fileHash,
    },
  });
}
