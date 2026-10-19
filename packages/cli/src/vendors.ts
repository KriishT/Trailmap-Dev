import { scan, VENDORS, SCANNER_VERSION } from "@trailmap/scanner";
import { buildVendorInventory, vendorInventoryCsv, type VendorRow, type DependencyGraph } from "@trailmap/graph";
import { plural, table } from "./format.js";

export interface VendorsOptions {
  dir: string;
  exclude?: string[];
  includeTests?: boolean;
}

export interface VendorsResult {
  graph: DependencyGraph;
  rows: VendorRow[];
}

export async function collectVendors(opts: VendorsOptions): Promise<VendorsResult> {
  const graph = await scan({ rootDir: opts.dir, exclude: opts.exclude, includeTests: opts.includeTests });
  const catalog = VENDORS.map((v) => ({ id: v.id, name: v.name, category: v.category, website: v.website }));
  return { graph, rows: buildVendorInventory(graph, catalog) };
}

/** First piece of evidence as `file:line`, the thing a reviewer clicks on. */
function cite(row: VendorRow): string {
  const e = row.evidence.find((x) => x.line) ?? row.evidence[0];
  return e ? `${e.source}${e.line ? `:${e.line}` : ""}` : "";
}

export function renderVendorsTable(rows: VendorRow[]): string {
  if (rows.length === 0) {
    return "No third-party vendors or subprocessors detected.\nTrailmap looks at SDK imports, outbound hostnames and environment variables read by your code; it ignores comments, tests and docs.";
  }
  const body = table(
    ["Vendor", "Category", "Used by", "Data (evidenced)", "Data (possible)", "Confidence", "Evidence"],
    rows.map((r) => [
      r.name, r.category, r.usedBy.map((u) => u.name).join(", "), r.evidencedClasses.join(", ") || "-",
      r.possibleClasses.join(", ") || "-", r.confidence, cite(r),
    ])
  );
  const evidenced = rows.filter((r) => r.evidencedClasses.length).length;
  return `${body}\n\n${plural(rows.length, "vendor")} found, ${evidenced} with data classes seen at a call site. Run with --csv for a spreadsheet.`;
}

export { vendorInventoryCsv, SCANNER_VERSION };
