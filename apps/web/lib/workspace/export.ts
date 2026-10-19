import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { getFramework, sheetsFor } from "@trailmap/frameworks";
import { buildVendorInventory, doraRegisterAssistCsv, vendorInventoryCsv, type DependencyGraph } from "@trailmap/graph";
import { buildEvidencePdf, layoutScene, sceneToSvg, themeFor, type Scene, type SheetKind, type TitleBlock } from "@trailmap/sheets";
import { SCANNER_VERSION } from "@trailmap/scanner";
import type { WorkspaceData } from "./types";

export type ExportFormat = "pdf" | "svg" | "json" | "csv" | "pack";

export interface ExportRequest {
  format: ExportFormat;
  /** pci | soc2 | dora (or an alias). */
  framework: string;
  sheet?: SheetKind;
  theme?: "light" | "dark";
  period?: { start: string; end: string } | null;
  preparedBy: string | null;
}

export interface ExportResult {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  fileHash: string;
  graphHash: string;
  frameworkId: string;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const SHEET_ORDER: SheetKind[] = ["system", "data-flow", "network"];
const SHEET_BY_UI: Record<string, SheetKind> = { system: "system", "data-flow": "data-flow", network: "network" };

export const isIsoDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function reviewerOf(data: WorkspaceData): string | null {
  const hash = data.graph.meta.graphHash;
  return data.attestations.find((a) => a.kind === "snapshot_review" && a.graphHash === hash)?.actor ?? null;
}

async function scenesFor(data: WorkspaceData, kinds: SheetKind[]): Promise<Scene[]> {
  const scopes = data.scopes.map((s) => ({ id: s.id, name: s.name, nodeIds: s.nodeIds }));
  return Promise.all(
    kinds.map((kind) => layoutScene(data.effective, { kind, scopes, highlightNodeIds: data.highlightNodeIds, highlightEdgeIds: data.highlightEdgeIds }))
  );
}

function titleBlock(data: WorkspaceData, scene: Scene, sheet: number, sheets: number, req: ExportRequest): TitleBlock {
  const rev = data.revisions.find((r) => r.id === data.selectedId);
  return {
    repo: data.repo.fullName, commit: rev?.commitSha ?? null, date: rev?.scannedAt ?? data.graph.meta.scanned_at, sheet, sheets,
    sheetTitle: scene.title, revision: rev?.label ?? null, preparedBy: req.preparedBy, reviewedBy: reviewerOf(data),
    graphHash: data.graph.meta.graphHash ?? null, scannerVersion: data.graph.meta.scannerVersion ?? SCANNER_VERSION,
  };
}

function inventory(data: WorkspaceData) {
  return buildVendorInventory(data.effective, data.catalog, data.vendorMeta);
}

function revisionRows(data: WorkspaceData, period: ExportRequest["period"]) {
  return data.revisions
    .filter((r) => !period || (r.scannedAt.slice(0, 10) >= period.start && r.scannedAt.slice(0, 10) <= period.end))
    .map((r) => ({ label: r.label, date: r.scannedAt, commit: r.commitSha, graphHash: r.graphHash ?? "", summary: r.summary }));
}

/** Build an export from workspace data. Pure: no database, no network, deterministic for the same input. */
export async function buildExport(data: WorkspaceData, req: ExportRequest): Promise<ExportResult> {
  const framework = getFramework(req.framework);
  if (!framework) throw new Error(`Unknown framework "${req.framework}"`);
  const graphHash = data.graph.meta.graphHash ?? "";
  const rev = data.revisions.find((r) => r.id === data.selectedId);
  const stamp = (rev?.scannedAt ?? data.graph.meta.scanned_at).slice(0, 10);
  const base = `trailmap-${framework.id}-${data.repo.fullName.replace("/", "-")}-${stamp}`;
  const theme = themeFor(req.theme ?? "light");

  const finish = (filename: string, contentType: string, bytes: Uint8Array): ExportResult => ({
    filename, contentType, bytes, fileHash: sha256(bytes), graphHash, frameworkId: framework.id,
  });

  if (req.format === "json") {
    const body = { repository: data.repo.fullName, revision: rev?.label, snapshotId: data.selectedId, framework: framework.id, graphHash, graph: data.effective, scopes: data.scopes, overrides: data.overrides, attestations: data.attestations };
    return finish(`${base}.json`, "application/json", strToU8(JSON.stringify(body, null, 2)));
  }

  if (req.format === "csv") {
    const rows = inventory(data);
    const csv = framework.id === "dora" ? doraRegisterAssistCsv(rows) : vendorInventoryCsv(rows);
    return finish(`${base}-${framework.id === "dora" ? "register-assist" : "vendors"}.csv`, "text/csv; charset=utf-8", strToU8(csv));
  }

  if (req.format === "svg") {
    const kind = req.sheet ?? "system";
    const [scene] = await scenesFor(data, [kind]);
    const svg = sceneToSvg(scene!, { theme, titleBlock: titleBlock(data, scene!, SHEET_ORDER.indexOf(kind) + 1, SHEET_ORDER.length, req) });
    return finish(`${base}-${kind}.svg`, "image/svg+xml", strToU8(svg));
  }

  const kinds = SHEET_ORDER.filter((k) => sheetsFor([framework.id]).includes(k === "data-flow" ? "data-flow" : k as never) || k === "system");
  const scenes = await scenesFor(data, kinds);
  const pdf = await buildEvidencePdf({
    repo: data.repo.fullName, commit: rev?.commitSha ?? null, date: rev?.scannedAt ?? data.graph.meta.scanned_at, graphHash,
    scannerVersion: data.graph.meta.scannerVersion ?? SCANNER_VERSION,
    framework: { name: framework.name, version: framework.version, disclaimer: framework.disclaimer, requirements: framework.requirements.map((r) => ({ id: r.id, title: r.title, summary: r.summary, verify: r.verify })) },
    preparedBy: req.preparedBy, reviewedBy: reviewerOf(data), period: req.period ?? null, scenes,
    vendors: inventory(data), graph: data.effective, revisions: revisionRows(data, req.period),
    overrides: data.overrides.map((o) => ({ kind: o.kind, reason: o.reason, actor: o.actor, createdAt: o.createdAt })),
    attestations: data.attestations.map((a) => ({ kind: a.kind, actor: a.actor, note: a.note, createdAt: a.createdAt, graphHash: a.graphHash })),
    theme,
  });

  if (req.format === "pdf") return finish(`${base}.pdf`, "application/pdf", pdf);

  // pack: the PDF, each sheet as SVG, and the data behind them, with a manifest of hashes
  const files: Record<string, Uint8Array> = { [`${base}.pdf`]: pdf };
  scenes.forEach((scene, i) => {
    files[`sheets/${i + 1}-${scene.kind}.svg`] = strToU8(sceneToSvg(scene, { theme, titleBlock: titleBlock(data, scene, i + 1, scenes.length, req) }));
  });
  files["data/graph.json"] = strToU8(JSON.stringify(data.effective, null, 2));
  files["data/vendors.csv"] = strToU8(vendorInventoryCsv(inventory(data)));
  if (framework.id === "dora") files["data/dora-register-assist.csv"] = strToU8(doraRegisterAssistCsv(inventory(data)));
  const manifest = {
    repository: data.repo.fullName, framework: { id: framework.id, name: framework.name, version: framework.version }, revision: rev?.label ?? null,
    graphHash, scannerVersion: data.graph.meta.scannerVersion ?? SCANNER_VERSION, preparedBy: req.preparedBy, reviewedBy: reviewerOf(data),
    period: req.period ?? null, disclaimer: framework.disclaimer, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)])),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return finish(`${base}.zip`, "application/zip", zipSync(files, { mtime: new Date(Date.UTC(2020, 0, 1)) }));
}

export type { DependencyGraph };
export { SHEET_BY_UI };
