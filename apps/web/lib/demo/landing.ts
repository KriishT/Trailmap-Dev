import { buildVendorInventory } from "@trailmap/graph";
import { VENDORS } from "@trailmap/scanner";
import { renderSheet } from "../workspace/scene";
import { demoWorkspace } from "./workspace";

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

let cached: ReturnType<typeof compute> | null = null;

async function compute() {
  const data = demoWorkspace();
  const sheet = await renderSheet(data, { sheet: "system" });
  const rows = buildVendorInventory(data.effective, data.catalog.length ? data.catalog : VENDORS.map((v) => ({ id: v.id, name: v.name, category: v.category, website: v.website })), data.vendorMeta);
  const cite = (r: (typeof rows)[number]) => {
    const e = r.evidence.find((x) => x.line) ?? r.evidence[0];
    return e ? `${e.source}${e.line ? `:${e.line}` : ""}` : "";
  };
  const vendorsOutput = table(
    ["Vendor", "Category", "Used by", "Data (evidenced)", "Confidence", "Evidence"],
    rows.map((r) => [r.name, r.category, r.usedBy.map((u) => u.name).join(", "), r.evidencedClasses.join(", ") || "-", r.confidence, cite(r)])
  );
  return {
    sheet,
    vendorsOutput,
    vendorCount: rows.length,
    revisions: data.revisions.map((r) => ({ label: r.label, date: r.scannedAt.slice(0, 10), summary: r.summary })),
    drift: data.drift[0]!,
    firstVendor: rows[0] ? { name: rows[0].name, cite: cite(rows[0]), kind: rows[0].evidence[0]?.kind ?? "", detail: rows[0].evidence[0]?.detail ?? "", snippet: rows[0].evidence[0]?.snippet ?? "" } : null,
  };
}

/** Everything the landing page shows comes from the sample data, so the page cannot drift from the product. */
export function landingData() {
  cached ??= compute();
  return cached;
}
