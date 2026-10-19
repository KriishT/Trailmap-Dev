import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import type { DataClass, DependencyGraph, VendorRow } from "@trailmap/graph";
import { CONFIDENCE_DASH, LIGHT, type Theme } from "./theme.js";
import type { Scene } from "./types.js";
import type { TitleBlock } from "./svg.js";

/**
 * Evidence-pack PDF. It is drawn directly from the same scenes as the SVG sheets, with vector
 * graphics and real text (selectable, searchable). Standard PDF fonts are used so the file is
 * self-contained; text is limited to Latin-1, other characters become "?".
 */

export interface PdfInput {
  repo: string;
  commit: string | null;
  date: string;
  graphHash: string;
  scannerVersion: string | null;
  framework: { name: string; version: string; disclaimer: string; requirements: Array<{ id: string; title: string; summary: string; verify: string }> };
  preparedBy: string | null;
  reviewedBy: string | null;
  period?: { start: string; end: string } | null;
  scenes: Scene[];
  vendors: VendorRow[];
  graph: DependencyGraph;
  revisions: Array<{ label: string; date: string; commit: string | null; graphHash: string; summary: string }>;
  overrides: Array<{ kind: string; reason: string; actor: string; createdAt: string }>;
  attestations: Array<{ kind: string; actor: string; note: string | null; createdAt: string; graphHash: string }>;
  theme?: Theme;
}

const PAGE_W = 1190; // A3 landscape in points
const PAGE_H = 842;
const M = 36;

const hex = (c: string): RGB => {
  const v = c.replace("#", "");
  return rgb(Number.parseInt(v.slice(0, 2), 16) / 255, Number.parseInt(v.slice(2, 4), 16) / 255, Number.parseInt(v.slice(4, 6), 16) / 255);
};

/** Standard fonts only encode Latin-1. */
export const latin1 = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, (ch) => (ch === "·" ? "·" : ch === "…" ? "..." : "?"));

interface Ctx {
  doc: PDFDocument;
  sans: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  t: Theme;
  input: PdfInput;
  total: number;
}

function text(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color: RGB) {
  page.drawText(latin1(s), { x, y, size, font, color });
}

function wrap(s: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin1(s).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

function frame(ctx: Ctx, page: PDFPage, sheet: number, sheetTitle: string) {
  const { t, input } = ctx;
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: hex(t.paper) });
  // title block, bottom right
  const bw = 330, bh = 132, bx = PAGE_W - M - bw, by = M;
  page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: hex(t.paperRaised), borderColor: hex(t.ink), borderWidth: 1.2 });
  text(page, "TRAILMAP", bx + 8, by + bh - 14, 9, ctx.bold, hex(t.ink));
  const rows: Array<[string, string]> = [
    ["REPOSITORY", input.repo], ["COMMIT", input.commit ? input.commit.slice(0, 12) : "not recorded"], ["DATE", input.date.slice(0, 10)],
    ["SHEET", `${sheet} of ${ctx.total}: ${sheetTitle}`], ["PREPARED BY", input.preparedBy ?? "not recorded"], ["REVIEWED BY", input.reviewedBy ?? "not reviewed"],
    ["SCANNER", input.scannerVersion ?? "unknown"],
  ];
  rows.forEach(([k, v], i) => {
    const y = by + bh - 28 - i * 12.5;
    page.drawLine({ start: { x: bx, y: y + 9 }, end: { x: bx + bw, y: y + 9 }, thickness: 0.4, color: hex(t.rule) });
    text(page, k, bx + 8, y, 6.5, ctx.sans, hex(t.ink3));
    text(page, v.length > 52 ? v.slice(0, 51) + "..." : v, bx + 92, y, 7.5, ctx.mono, hex(t.ink));
  });
  text(page, "GRAPH HASH", bx + 8, by + 17, 6.5, ctx.sans, hex(t.ink3));
  text(page, input.graphHash, bx + 8, by + 7, 6, ctx.mono, hex(t.ink));
  text(page, `${input.framework.name} ${input.framework.version}`, M, PAGE_H - M + 8, 8, ctx.sans, hex(t.ink3));
}

function drawScene(ctx: Ctx, page: PDFPage, scene: Scene) {
  const { t } = ctx;
  const top = PAGE_H - M - 30;
  const availW = PAGE_W - 2 * M;
  const availH = top - (M + 150);
  const sc = Math.min(1, availW / Math.max(scene.width, 1), availH / Math.max(scene.height, 1));
  const X = (x: number) => M + x * sc;
  const Y = (y: number) => top - y * sc;

  for (const s of scene.scopes) {
    page.drawRectangle({ x: X(s.x), y: Y(s.y + s.h), width: s.w * sc, height: s.h * sc, color: hex(t.paperRaised), opacity: 0.5, borderColor: hex(t.ink3), borderWidth: 0.8, borderDashArray: [5, 3] });
    // diagonal hatching, clipped to the rectangle by construction
    for (let d = -s.h; d < s.w; d += 9) {
      const x1 = Math.max(0, d), y1 = x1 - d, x2 = Math.min(s.w, d + s.h), y2 = x2 - d;
      page.drawLine({ start: { x: X(s.x + x1), y: Y(s.y + y1) }, end: { x: X(s.x + x2), y: Y(s.y + y2) }, thickness: 0.3, color: hex(t.ink3), opacity: 0.5 });
    }
    text(page, s.name.toUpperCase(), X(s.x) + 5, Y(s.y) - 10, 7, ctx.bold, hex(t.ink));
  }
  for (const e of scene.edges) {
    const cls = e.evidenced[0];
    const color = cls ? hex(t.classColor[cls]) : hex(t.ink2);
    const dash = CONFIDENCE_DASH[e.confidence];
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i]!, b = e.points[i + 1]!;
      if (e.highlighted) page.drawLine({ start: { x: X(a.x), y: Y(a.y) }, end: { x: X(b.x), y: Y(b.y) }, thickness: 5, color: hex(t.attention) });
      page.drawLine({ start: { x: X(a.x), y: Y(a.y) }, end: { x: X(b.x), y: Y(b.y) }, thickness: cls ? 1.6 : 1, color, dashArray: dash ? dash.split(" ").map(Number) : undefined });
    }
    const last = e.points[e.points.length - 1]!;
    const prev = e.points[e.points.length - 2] ?? last;
    const dx = Math.sign(last.x - prev.x), dy = Math.sign(last.y - prev.y);
    const tipX = X(last.x), tipY = Y(last.y);
    page.drawLine({ start: { x: tipX, y: tipY }, end: { x: tipX - dx * 6 + dy * 3, y: tipY + dy * 6 + dx * 3 }, thickness: 1, color });
    page.drawLine({ start: { x: tipX, y: tipY }, end: { x: tipX - dx * 6 - dy * 3, y: tipY + dy * 6 - dx * 3 }, thickness: 1, color });
    const mid = e.points[Math.floor(e.points.length / 2)]!;
    const tags = [...e.evidenced, ...e.possible.filter((p) => !e.evidenced.includes(p)).map((p) => `${p}?`), ...(e.crossesScope ? ["BOUNDARY"] : [])];
    tags.forEach((tag, i) => text(page, tag, X(mid.x) + 2 + i * 34, Y(mid.y) + 3, 6, ctx.mono, e.crossesScope && tag === "BOUNDARY" ? hex(t.danger) : hex(t.ink)));
  }
  for (const n of scene.nodes) {
    page.drawRectangle({ x: X(n.x), y: Y(n.y + n.h), width: n.w * sc, height: n.h * sc, color: hex(n.highlighted ? t.attention : t.paperRaised), borderColor: hex(t.ink), borderWidth: 0.8 });
    text(page, n.label.length > 28 ? n.label.slice(0, 27) + "..." : n.label, X(n.x) + 6, Y(n.y) - 16 * sc, Math.max(6, 11 * sc), ctx.bold, hex(t.ink));
    text(page, n.sublabel, X(n.x) + 6, Y(n.y) - 30 * sc, Math.max(5, 7.5 * sc), ctx.sans, hex(n.highlighted ? t.ink : t.ink2));
    if (n.public) text(page, "INTERNET-FACING", X(n.x), Y(n.y) + 4, 6, ctx.mono, hex(t.danger));
    n.evidenced.forEach((c: DataClass, i) => text(page, c, X(n.x) + 6 + i * 30, Y(n.y + n.h) - 9, 6, ctx.mono, hex(t.classColor[c])));
  }
  if (scene.emptyReason) text(page, scene.emptyReason, M, top - 20, 10, ctx.sans, hex(t.ink2));
  // key
  const ky = M + 112;
  text(page, "KEY", M, ky, 7, ctx.bold, hex(t.ink));
  [["Solid: high confidence", ""], ["Dashed: medium confidence", CONFIDENCE_DASH.medium], ["Dotted: low confidence", CONFIDENCE_DASH.low]].forEach(([label, dash], i) => {
    const y = ky - 14 - i * 12;
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: M + 28, y: y + 3 }, thickness: 1, color: hex(t.ink2), dashArray: dash ? dash!.split(" ").map(Number) : undefined });
    text(page, label!, M + 36, y, 7, ctx.sans, hex(t.ink2));
  });
  text(page, "Hatched: compliance scope. Highlighted: new or changed. A trailing ? marks a possible, unconfirmed data class.", M, ky - 54, 7, ctx.sans, hex(t.ink2));
}

/** A simple paginated table / text page. Returns nothing; adds pages as needed. */
function tablePages(ctx: Ctx, title: string, header: string[], widths: number[], rows: string[][], next: () => PDFPage, sheetTitle: (n: number) => string) {
  let page = next();
  let y = PAGE_H - M - 40;
  const draw = (cells: string[], bold: boolean) => {
    const lines = cells.map((c, i) => wrap(c, bold ? ctx.bold : ctx.sans, 7.5, widths[i]! - 8));
    const h = Math.max(...lines.map((l) => l.length)) * 9.5 + 6;
    if (y - h < M + 170) { page = next(); y = PAGE_H - M - 40; draw(header, true); }
    let x = M;
    lines.forEach((ls, i) => { ls.forEach((l, k) => text(page, l, x + 4, y - 9 - k * 9.5, 7.5, bold ? ctx.bold : ctx.sans, hex(ctx.t.ink))); x += widths[i]!; });
    page.drawLine({ start: { x: M, y: y - h }, end: { x: M + widths.reduce((a, b) => a + b, 0), y: y - h }, thickness: 0.4, color: hex(ctx.t.rule) });
    y -= h;
  };
  text(page, title, M, PAGE_H - M - 14, 14, ctx.bold, hex(ctx.t.ink));
  void sheetTitle;
  draw(header, true);
  if (rows.length === 0) text(page, "None.", M + 4, y - 14, 8, ctx.sans, hex(ctx.t.ink2));
  for (const r of rows) draw(r, false);
}

async function render(input: PdfInput, total: number): Promise<{ bytes: Uint8Array; pages: number }> {
  const t = input.theme ?? LIGHT;
  const doc = await PDFDocument.create();
  const fixed = new Date(`${input.date.slice(0, 10)}T00:00:00.000Z`);
  doc.setTitle(`${input.framework.name} evidence: ${input.repo}`);
  doc.setSubject(`Graph hash ${input.graphHash}`);
  doc.setAuthor(input.preparedBy ?? "Trailmap");
  doc.setProducer("Trailmap");
  doc.setCreator("Trailmap");
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const [sans, bold, mono] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold), doc.embedFont(StandardFonts.Courier)]);

  const ctx: Ctx = { doc, sans, bold, mono, t, input, total };
  let counter = 0;
  const addPage = (title: string): PDFPage => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    counter++;
    frame(ctx, page, counter, title);
    return page;
  };

  // Cover
  const cover = addPage("Cover");
  text(cover, `${input.framework.name} ${input.framework.version}`, M, PAGE_H - 110, 26, bold, hex(t.ink));
  text(cover, "Architecture and data-flow evidence", M, PAGE_H - 142, 16, sans, hex(t.ink2));
  const meta: Array<[string, string]> = [
    ["Repository", input.repo], ["Commit", input.commit ?? "not recorded"], ["Snapshot date", input.date.slice(0, 10)], ["Graph hash (sha256)", input.graphHash],
    ["Scanner", input.scannerVersion ?? "unknown"], ["Prepared by", input.preparedBy ?? "not recorded"], ["Reviewed by", input.reviewedBy ?? "not reviewed"],
    ["Audit period", input.period ? `${input.period.start} to ${input.period.end}` : "not set"],
  ];
  meta.forEach(([k, v], i) => { text(cover, k, M, PAGE_H - 200 - i * 20, 9, sans, hex(t.ink3)); text(cover, v, M + 140, PAGE_H - 200 - i * 20, 9.5, mono, hex(t.ink)); });
  let cy = PAGE_H - 390;
  for (const l of wrap(input.framework.disclaimer, sans, 10, 760)) { text(cover, l, M, cy, 10, sans, hex(t.ink)); cy -= 14; }
  cy -= 10;
  text(cover, "Requirements this pack supports", M, cy, 11, bold, hex(t.ink)); cy -= 18;
  for (const r of input.framework.requirements) {
    text(cover, `${r.id}  ${r.title}`, M, cy, 9.5, bold, hex(t.ink)); cy -= 12;
    for (const l of wrap(`Verify: ${r.verify}`, sans, 8.5, 760)) { if (cy > M + 150) { text(cover, l, M + 12, cy, 8.5, sans, hex(t.ink2)); cy -= 11; } }
    cy -= 4;
  }

  // Sheets
  for (const scene of input.scenes) drawScene(ctx, addPage(scene.title), scene);

  const tp = (title: string, header: string[], widths: number[], rows: string[][]) =>
    tablePages(ctx, title, header, widths, rows, () => addPage(title), () => title);

  tp("Vendor and subprocessor inventory", ["Vendor", "Category", "Used by", "Data (evidenced)", "Data (possible)", "Confidence", "Purpose", "Region", "DPA"], [130, 90, 170, 110, 110, 70, 150, 60, 50],
    input.vendors.map((v) => [v.name, v.category, v.usedBy.map((u) => u.name).join(", "), v.evidencedClasses.join(", ") || "-", v.possibleClasses.join(", ") || "-", v.confidence, v.purpose, v.region, v.dpaOnFile === null ? "unknown" : v.dpaOnFile ? "yes" : "no"]));

  const names = new Map(input.graph.nodes.map((n) => [n.id, n.name]));
  const classRows: string[][] = [];
  for (const e of input.graph.edges) for (const tag of e.dataClasses ?? []) {
    const ev = tag.evidence.find((x) => x.line) ?? tag.evidence[0];
    classRows.push([tag.class, names.get(e.from) ?? e.from, names.get(e.to) ?? e.to, tag.certainty, ev ? `${ev.source}${ev.line ? `:${ev.line}` : ""}` : ""]);
  }
  classRows.sort((a, b) => a.join("|").localeCompare(b.join("|")));
  tp("Data classes in transit and at rest", ["Class", "From", "To", "Certainty", "Evidence"], [90, 220, 220, 90, 400], classRows);

  tp("Revision log", ["Revision", "Date", "Commit", "Graph hash", "Changes"], [70, 90, 100, 330, 350], input.revisions.map((r) => [r.label, r.date.slice(0, 10), r.commit?.slice(0, 12) ?? "", r.graphHash, r.summary]));

  tp("Overrides and attestation trail", ["Kind", "By", "When", "Reason or note", "Graph hash"],
    [120, 160, 100, 360, 240],
    [...input.overrides.map((o) => [`override: ${o.kind}`, o.actor, o.createdAt.slice(0, 10), o.reason, ""]),
     ...input.attestations.map((a) => [`attestation: ${a.kind}`, a.actor, a.createdAt.slice(0, 10), a.note ?? "", a.graphHash])]);

  const evRows: string[][] = [];
  for (const e of input.graph.edges) for (const ev of e.evidence ?? []) {
    evRows.push([`${names.get(e.from) ?? e.from} to ${names.get(e.to) ?? e.to}`, e.type, e.confidence, ev.kind, `${ev.source}${ev.line ? `:${ev.line}` : ""}`, ev.detail]);
  }
  tp("Evidence appendix", ["Connection", "Type", "Confidence", "Evidence", "File", "Detail"], [230, 60, 70, 90, 280, 290], evRows);

  return { bytes: await doc.save({ useObjectStreams: false }), pages: counter };
}

/** Render the pack. Pages are counted on a first pass so every title block can say "sheet n of N". */
export async function buildEvidencePdf(input: PdfInput): Promise<Uint8Array> {
  const first = await render(input, 0);
  return (await render(input, first.pages)).bytes;
}

export type { TitleBlock };
