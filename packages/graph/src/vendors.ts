import type { Confidence, DataClass, DependencyGraph, GraphEvidence } from "./schema.js";
import { edgeKey } from "./diff.js";

/** What a person recorded about a vendor that code cannot tell us. */
export interface VendorMetadata {
  vendorId: string;
  purpose?: string;
  region?: string;
  dpaOnFile?: boolean;
  notes?: string;
}

export interface VendorUser {
  id: string;
  name: string;
}

export interface VendorRow {
  /** Catalog id (`stripe`) or `ext:host` for hosts not in the catalog. */
  vendorId: string;
  name: string;
  category: string;
  website: string;
  kind: "catalog" | "external";
  usedBy: VendorUser[];
  evidencedClasses: DataClass[];
  possibleClasses: DataClass[];
  confidence: Confidence;
  evidence: GraphEvidence[];
  purpose: string;
  region: string;
  dpaOnFile: boolean | null;
  notes: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  website: string;
}

const confRank: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

const EVIDENCE_RANK: Record<string, number> = {
  "call-site": 0, "sdk-import": 1, "http-call": 2, env: 3, schema: 4, iac: 5, terraform: 5, cloudformation: 5,
  compose: 6, kubernetes: 6, helm: 6, import: 7, manual: 8, dependency: 9, declared: 10,
};

/**
 * The subprocessor / third-party inventory for a graph. `catalog` supplies display names and
 * categories; unknown hosts are listed as external, uncategorised vendors.
 */
export function buildVendorInventory(
  graph: DependencyGraph,
  catalog: CatalogEntry[],
  metadata: VendorMetadata[] = []
): VendorRow[] {
  const byCatalog = new Map(catalog.map((c) => [c.id, c]));
  const meta = new Map(metadata.map((m) => [m.vendorId, m]));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const rows: VendorRow[] = [];

  for (const node of graph.nodes) {
    if (node.type !== "saas" && node.type !== "external") continue;
    const vendorId = node.type === "saas" ? (node.vendor ?? node.id) : node.id;
    const entry = node.type === "saas" ? byCatalog.get(vendorId) : undefined;
    const incoming = graph.edges.filter((e) => e.to === node.id);
    const users = new Map<string, VendorUser>();
    const evidenced = new Set<DataClass>();
    const possible = new Set<DataClass>();
    let best: Confidence = "low";
    const evidence: GraphEvidence[] = [];
    for (const e of incoming) {
      const from = nodes.get(e.from);
      if (from && from.type !== "network") users.set(from.id, { id: from.id, name: from.name });
      if (confRank[e.confidence] > confRank[best]) best = e.confidence;
      for (const t of e.dataClasses ?? []) (t.certainty === "evidenced" ? evidenced : possible).add(t.class);
      for (const ev of e.evidence ?? []) if (ev.kind !== "declared") evidence.push(ev);
    }
    for (const c of evidenced) possible.delete(c);
    // Show the most direct proof first: a call or import in code beats a manifest or deploy line.
    evidence.sort((a, b) => (EVIDENCE_RANK[a.kind] ?? 9) - (EVIDENCE_RANK[b.kind] ?? 9) || a.source.localeCompare(b.source) || (a.line ?? 0) - (b.line ?? 0));
    const m = meta.get(vendorId);
    evidence.length = Math.min(evidence.length, 6);
    rows.push({
      vendorId,
      name: entry?.name ?? node.name,
      category: entry?.category ?? "unclassified",
      website: entry?.website ?? "",
      kind: node.type === "saas" ? "catalog" : "external",
      usedBy: [...users.values()].sort((a, b) => a.name.localeCompare(b.name)),
      evidencedClasses: [...evidenced].sort(),
      possibleClasses: [...possible].sort(),
      confidence: incoming.length ? best : "low",
      evidence,
      purpose: m?.purpose ?? "",
      region: m?.region ?? "",
      dpaOnFile: m?.dpaOnFile ?? null,
      notes: m?.notes ?? "",
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** RFC 4180 CSV: quote fields containing commas, quotes or newlines, and double embedded quotes. */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const yesNo = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");

/** Inventory as CSV for spreadsheets. */
export function vendorInventoryCsv(rows: VendorRow[]): string {
  return toCsv([
    ["Vendor", "Category", "Website", "Used by", "Data classes (evidenced)", "Data classes (possible)", "Confidence", "Purpose", "Region", "DPA on file", "Notes"],
    ...rows.map((r) => [
      r.name, r.category, r.website, r.usedBy.map((u) => u.name).join("; "), r.evidencedClasses.join("; "),
      r.possibleClasses.join("; "), r.confidence, r.purpose, r.region, yesNo(r.dpaOnFile), r.notes,
    ]),
  ]);
}

/**
 * Starting point for the DORA Article 28(3) register of information on ICT third-party providers.
 * It fills what can be derived from code. Every row is marked as an assist: the entity must
 * complete and verify the register itself before submitting it.
 */
export function doraRegisterAssistCsv(rows: VendorRow[]): string {
  return toCsv([
    ["ICT third-party service provider", "Category of service", "Provider website", "Functions / services supported (derived)", "Data processed (derived)", "Location of data processing", "Contractual arrangement (DPA)", "Review status"],
    ...rows.map((r) => [
      r.name, r.purpose || r.category, r.website, r.usedBy.map((u) => u.name).join("; "),
      [...r.evidencedClasses, ...r.possibleClasses.map((c) => `${c} (possible)`)].join("; "),
      r.region, yesNo(r.dpaOnFile), "Assist only: verify before submission",
    ]),
  ]);
}

export { edgeKey };
