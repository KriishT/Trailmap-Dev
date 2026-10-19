import { NextResponse } from "next/server";
import { demoWorkspace } from "@/lib/demo/workspace";
import { buildExport, isIsoDate, type ExportFormat } from "@/lib/workspace/export";
import type { SheetKind } from "@trailmap/sheets";

const FORMATS = new Set<string>(["pdf", "svg", "json", "csv", "pack"]);
const SHEETS = new Set<string>(["system", "data-flow", "network"]);

/** Export the sample workspace. Nothing is recorded because nothing here belongs to anyone. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const format = (q.get("format") ?? "pdf") as ExportFormat;
  const sheet = (q.get("sheet") ?? "system") as SheetKind;
  if (!FORMATS.has(format) || !SHEETS.has(sheet)) return NextResponse.json({ error: "Unknown format or sheet" }, { status: 400 });
  const start = q.get("periodStart");
  const end = q.get("periodEnd");
  if ((start || end) && (!isIsoDate(start) || !isIsoDate(end) || start > end)) return NextResponse.json({ error: "periodStart and periodEnd must be dates (YYYY-MM-DD) with start before end" }, { status: 400 });
  try {
    const out = await buildExport(demoWorkspace(q.get("rev")), {
      format, sheet, framework: q.get("framework") ?? "pci", theme: q.get("theme") === "dark" ? "dark" : "light",
      period: start && end ? { start, end } : null, preparedBy: "Sample data (demo)",
    });
    return new NextResponse(Buffer.from(out.bytes), {
      headers: {
        "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store",
        "X-Trailmap-Graph-Hash": out.graphHash, "X-Trailmap-File-Hash": out.fileHash,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Export failed" }, { status: 400 });
  }
}
