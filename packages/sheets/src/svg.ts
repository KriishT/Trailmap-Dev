import type { DataClass } from "@trailmap/graph";
import { CONFIDENCE_DASH, LIGHT, type Theme } from "./theme.js";
import type { Point, Scene, SceneEdge, SceneNode } from "./types.js";

export interface TitleBlock {
  repo: string;
  commit: string | null;
  /** ISO date of the snapshot. */
  date: string;
  sheet: number;
  sheets: number;
  sheetTitle: string;
  revision?: string | null;
  preparedBy: string | null;
  reviewedBy: string | null;
  graphHash: string | null;
  scannerVersion?: string | null;
}

export interface SvgOptions {
  theme?: Theme;
  titleBlock?: TitleBlock;
  legend?: boolean;
  grid?: boolean;
  /** Add focusable, labelled elements and data attributes for the interactive viewer. */
  interactive?: boolean;
  /** Prefix for ids inside the SVG, so several can sit on one page. */
  idPrefix?: string;
}

const SANS = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";
const COND = "'IBM Plex Sans Condensed', 'Arial Narrow', Arial, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier New', monospace";
const MARGIN = 24;
const BLOCK_W = 400;
const BLOCK_H = 164;
const LEGEND_H = 170;

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const pathOf = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join(" ");

function sensitiveClass(classes: DataClass[]): DataClass | null {
  return classes[0] ?? null;
}

function stamp(cls: DataClass, x: number, y: number, t: Theme, possible: boolean): { svg: string; w: number } {
  const label = possible ? `${cls}?` : cls;
  const w = label.length * 6.4 + 10;
  const color = t.classColor[cls];
  return {
    w,
    svg: `<g class="stamp"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="14" fill="${t.paperRaised}" stroke="${color}" stroke-width="1"${possible ? ' stroke-dasharray="3 2"' : ""}/><text x="${n(x + w / 2)}" y="${n(y + 10.5)}" text-anchor="middle" font-family="${MONO}" font-size="9.5" font-weight="500" fill="${color}">${esc(label)}</text></g>`,
  };
}

function nodeShape(node: SceneNode, t: Theme): string {
  const { x, y, w, h } = node;
  const fill = node.highlighted ? t.attention : t.paperRaised;
  const stroke = node.type === "network" ? 2 : 1;
  const common = `fill="${fill}" stroke="${t.ink}" stroke-width="${stroke}"`;
  const x2 = x + w;
  const y2 = y + h;
  switch (node.type) {
    case "database":
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" ${common}/><line x1="${n(x)}" y1="${n(y + 6)}" x2="${n(x2)}" y2="${n(y + 6)}" stroke="${t.ink}" stroke-width="1"/><line x1="${n(x)}" y1="${n(y2 - 6)}" x2="${n(x2)}" y2="${n(y2 - 6)}" stroke="${t.ink}" stroke-width="1"/>`;
    case "saas":
    case "external":
      return `<polygon points="${n(x)},${n(y)} ${n(x2 - 10)},${n(y)} ${n(x2)},${n(y + 10)} ${n(x2)},${n(y2)} ${n(x)},${n(y2)}" ${common}/>`;
    case "queue":
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" ${common}/><line x1="${n(x + 6)}" y1="${n(y)}" x2="${n(x + 6)}" y2="${n(y2)}" stroke="${t.ink}" stroke-width="1"/><line x1="${n(x2 - 6)}" y1="${n(y)}" x2="${n(x2 - 6)}" y2="${n(y2)}" stroke="${t.ink}" stroke-width="1"/>`;
    case "storage":
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" ${common}/><line x1="${n(x)}" y1="${n(y2 - 6)}" x2="${n(x2)}" y2="${n(y2 - 6)}" stroke="${t.ink}" stroke-width="1" stroke-dasharray="4 2"/>`;
    case "loadbalancer":
    case "network":
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" ${common}/><rect x="${n(x + 3)}" y="${n(y + 3)}" width="${n(w - 6)}" height="${n(h - 6)}" rx="1" fill="none" stroke="${t.ink3}" stroke-width="1"/>`;
    default:
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" ${common}/>`;
  }
}

function describeNode(node: SceneNode): string {
  const parts = [`${node.label}, ${node.sublabel.toLowerCase()}`];
  if (node.public) parts.push("reachable from the internet");
  if (node.evidenced.length) parts.push(`handles ${node.evidenced.join(", ")}`);
  if (node.highlighted) parts.push("new or changed");
  return parts.join(", ");
}

function renderNode(node: SceneNode, t: Theme, interactive: boolean): string {
  const textColor = t.ink;
  const cx = node.x + 12;
  const label = node.label.length > 30 ? node.label.slice(0, 29) + "…" : node.label;
  const stamps: string[] = [];
  let sx = node.x + node.w;
  const all = [...node.evidenced.map((c) => ({ c, p: false })), ...node.possible.map((c) => ({ c, p: true }))];
  for (const { c, p } of all.reverse()) {
    const s = stamp(c, 0, node.y + node.h + 4, t, p);
    sx -= s.w + 4;
    stamps.push(stamp(c, sx, node.y + node.h + 4, t, p).svg);
  }
  const pub = node.public
    ? `<g class="public-tag"><rect x="${n(node.x)}" y="${n(node.y - 17)}" width="86" height="14" fill="${t.paperRaised}" stroke="${t.danger}" stroke-width="1"/><text x="${n(node.x + 43)}" y="${n(node.y - 6.5)}" text-anchor="middle" font-family="${MONO}" font-size="9" font-weight="500" fill="${t.danger}">INTERNET-FACING</text></g>`
    : "";
  const attrs = interactive
    ? ` data-node-id="${esc(node.id)}" tabindex="0" role="button" aria-label="${esc(describeNode(node))}"`
    : "";
  const texts = `<text x="${n(cx)}" y="${n(node.y + 21)}" font-family="${SANS}" font-size="13" font-weight="600" fill="${textColor}">${esc(label)}</text><text x="${n(cx)}" y="${n(node.y + 36)}" font-family="${COND}" font-size="9.5" letter-spacing="0.9" fill="${node.highlighted ? t.ink : t.ink2}">${esc(node.sublabel)}</text>${pub}${stamps.join("")}`;
  if (!interactive) return `<g class="node">${nodeShape(node, t)}${texts}</g>`;
  // The focusable element is the shape; its aria-label carries the name. The drawn text sits beside it,
  // hidden from assistive technology and transparent to clicks, so it is never read twice.
  return `<g class="node-wrap"><g class="node"${attrs}>${nodeShape(node, t)}</g><g class="node-text" aria-hidden="true" pointer-events="none">${texts}</g></g>`;
}

function midpoint(points: Point[]): Point {
  // Midpoint of the longest segment, so labels sit on a straight run.
  let best = { len: -1, a: points[0]!, b: points[points.length - 1]! };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (len > best.len) best = { len, a, b };
  }
  return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
}

const TYPE_TAG: Partial<Record<SceneEdge["type"], string>> = { database: "DB", queue: "QUEUE", storage: "STORE", network: "NET", import: "IMPORT" };

interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;

interface Tag { label: string; w: number; color: string; dashed: boolean; strong: boolean }

function tagSvg(tag: Tag, x: number, y: number, t: Theme): string {
  const fill = tag.strong ? t.paperRaised : t.paper;
  const stroke = tag.color;
  return `<g class="tag"><rect x="${n(x)}" y="${n(y)}" width="${n(tag.w)}" height="13" fill="${fill}" stroke="${stroke}" stroke-width="1"${tag.dashed ? ' stroke-dasharray="3 2"' : ""}/><text x="${n(x + tag.w / 2)}" y="${n(y + 9.5)}" text-anchor="middle" font-family="${MONO}" font-size="8.5"${tag.strong ? ' font-weight="500"' : ""} fill="${tag.color}">${esc(tag.label)}</text></g>`;
}

/** Candidate anchor points along an edge: the middle of each straight run, longest runs first. */
function candidates(points: Point[]): Point[] {
  const segs: Array<{ len: number; a: Point; b: Point }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    segs.push({ len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), a, b });
  }
  segs.sort((p, q) => q.len - p.len);
  const out: Point[] = [];
  for (const sgm of segs) for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) out.push({ x: sgm.a.x + (sgm.b.x - sgm.a.x) * f, y: sgm.a.y + (sgm.b.y - sgm.a.y) * f });
  return out;
}

function renderEdge(edge: SceneEdge, t: Theme, names: Map<string, string>, interactive: boolean, placed: Rect[]): string {
  const cls = sensitiveClass(edge.evidenced);
  const color = cls ? t.classColor[cls] : t.ink2;
  const width = cls ? 2 : 1.4;
  const dash = CONFIDENCE_DASH[edge.confidence];
  const d = pathOf(edge.points);
  const under = edge.highlighted ? `<path d="${d}" fill="none" stroke="${t.attention}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` : "";
  const line = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round" marker-end="url(#arrow-${edge.confidence})" data-confidence="${edge.confidence}"/>`;

  const tags: Tag[] = [];
  const typeTag = TYPE_TAG[edge.type];
  if (typeTag) tags.push({ label: typeTag, w: typeTag.length * 5.6 + 8, color: t.ink2, dashed: false, strong: false });
  for (const c of edge.evidenced) tags.push({ label: c, w: c.length * 5.6 + 8, color: t.classColor[c], dashed: false, strong: true });
  for (const c of edge.possible.filter((p) => !edge.evidenced.includes(p))) tags.push({ label: `${c}?`, w: (c.length + 1) * 5.6 + 8, color: t.classColor[c], dashed: true, strong: true });
  if (edge.crossesScope) tags.push({ label: "BOUNDARY", w: 8 * 5.6 + 8, color: t.danger, dashed: false, strong: true });

  let tagSvgs = "";
  if (tags.length) {
    const total = tags.reduce((sum, tg) => sum + tg.w + 3, -3);
    const tries: Rect[] = [];
    for (const p of candidates(edge.points)) {
      tries.push({ x: p.x - total / 2, y: p.y - 17, w: total, h: 13 });
      tries.push({ x: p.x - total / 2, y: p.y + 4, w: total, h: 13 });
    }
    const spot = tries.find((r) => !placed.some((q) => overlaps(r, q))) ?? tries[0]!;
    placed.push(spot);
    let x = spot.x;
    tagSvgs = tags.map((tg) => { const out = tagSvg(tg, x, spot.y, t); x += tg.w + 3; return out; }).join("");
  }

  const from = names.get(edge.from) ?? edge.from;
  const to = names.get(edge.to) ?? edge.to;
  const label = `${edge.type} connection from ${from} to ${to}, ${edge.confidence} confidence${edge.evidenced.length ? `, carries ${edge.evidenced.join(", ")}` : ""}${edge.crossesScope ? ", crosses a scope boundary" : ""}${edge.highlighted ? ", new or changed" : ""}`;
  // The stamps drawn on the line are part of its name, so what a sighted reader sees is what a screen reader hears.
  const stamps = tags.map((tg) => tg.label).join(" ");
  const full = `${edge.cite ? `${label}. Evidence: ${edge.cite}` : label}${stamps ? `. Stamps: ${stamps}` : ""}`;
  const attrs = interactive ? ` data-edge-id="${esc(edge.id)}" tabindex="0" role="button" aria-label="${esc(full)}"` : "";
  const hit = interactive ? `<path d="${d}" fill="none" stroke="transparent" stroke-width="12"/>` : "";
  const title = edge.cite ? `<title>${esc(full)}</title>` : "";
  if (!interactive) return `<g class="edge"${attrs}>${title}${under}${hit}${line}${tagSvgs}</g>`;
  // Stamps sit beside the focusable line, not inside it: they are drawn text, and the line's name already lists them.
  return `<g class="edge-wrap"><g class="edge"${attrs}>${title}${under}${hit}${line}</g><g class="edge-tags" aria-hidden="true" pointer-events="none">${tagSvgs}</g></g>`;
}

function legendSvg(t: Theme, x: number, y: number): string {
  const row = (i: number) => y + 22 + i * 17;
  const sample = (i: number, dash: string, label: string) =>
    `<line x1="${x}" y1="${row(i) - 4}" x2="${x + 34}" y2="${row(i) - 4}" stroke="${t.ink2}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ""}/><text x="${x + 44}" y="${row(i)}" font-family="${SANS}" font-size="10.5" fill="${t.ink2}">${label}</text>`;
  return `<g class="legend"><text x="${x}" y="${y + 6}" font-family="${COND}" font-size="10" letter-spacing="1.2" font-weight="600" fill="${t.ink}">KEY</text>${sample(0, "", "Solid: high confidence")}${sample(1, CONFIDENCE_DASH.medium, "Dashed: medium confidence")}${sample(2, CONFIDENCE_DASH.low, "Dotted: low confidence")}<rect x="${x}" y="${row(3) - 11}" width="34" height="12" fill="url(#hatch)" stroke="${t.ink3}" stroke-width="1" stroke-dasharray="4 3"/><text x="${x + 44}" y="${row(3)}" font-family="${SANS}" font-size="10.5" fill="${t.ink2}">Hatched: compliance scope</text><rect x="${x}" y="${row(4) - 11}" width="34" height="12" fill="${t.attention}"/><text x="${x + 44}" y="${row(4)}" font-family="${SANS}" font-size="10.5" fill="${t.ink2}">Highlighted: new or changed</text><text x="${x}" y="${row(5) + 2}" font-family="${SANS}" font-size="10.5" fill="${t.ink2}">Stamps: PII, PAN, PHI, CREDENTIALS. A ? marks a possible, unconfirmed flow.</text></g>`;
}

function titleBlockSvg(tb: TitleBlock, t: Theme, x: number, y: number): string {
  const rows: Array<[string, string]> = [
    ["REPOSITORY", tb.repo],
    ["COMMIT", tb.commit ? tb.commit.slice(0, 12) : "not recorded"],
    ["DATE", tb.date.slice(0, 10)],
    ["REVISION", tb.revision ?? "current"],
    ["SHEET", `${tb.sheet} of ${tb.sheets}: ${tb.sheetTitle}`],
    ["PREPARED BY", tb.preparedBy ?? "not recorded"],
    ["REVIEWED BY", tb.reviewedBy ?? "not reviewed"],
    ["SCANNER", tb.scannerVersion ?? "unknown"],
  ];
  const rowH = 14;
  const body = rows
    .map(([k, v], i) => {
      const ry = y + 31 + i * rowH;
      return `<line x1="${x}" y1="${ry - 10}" x2="${x + BLOCK_W}" y2="${ry - 10}" stroke="${t.rule}" stroke-width="1"/><text x="${x + 8}" y="${ry}" font-family="${COND}" font-size="8.5" letter-spacing="1" fill="${t.ink3}">${k}</text><text x="${x + 100}" y="${ry}" font-family="${MONO}" font-size="9.5" fill="${t.ink}">${esc(v.length > 46 ? v.slice(0, 45) + "…" : v)}</text>`;
    })
    .join("");
  const hy = y + 31 + rows.length * rowH;
  return `<g class="title-block"><rect x="${x}" y="${y}" width="${BLOCK_W}" height="${BLOCK_H}" fill="${t.paperRaised}" stroke="${t.ink}" stroke-width="1.5"/><text x="${x + 8}" y="${y + 14}" font-family="${COND}" font-size="10.5" letter-spacing="1.4" font-weight="600" fill="${t.ink}">TRAILMAP</text>${body}<line x1="${x}" y1="${hy - 10}" x2="${x + BLOCK_W}" y2="${hy - 10}" stroke="${t.rule}" stroke-width="1"/><text x="${x + 8}" y="${hy}" font-family="${COND}" font-size="8.5" letter-spacing="1" fill="${t.ink3}">GRAPH HASH</text><text x="${x + 8}" y="${hy + 12}" font-family="${MONO}" font-size="7.5" fill="${t.ink}">${esc(tb.graphHash ?? "not recorded")}</text></g>`;
}

/** Render a laid-out scene to a self-contained SVG document. Deterministic: same scene, same bytes. */
export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const t = opts.theme ?? LIGHT;
  const interactive = Boolean(opts.interactive);
  const names = new Map(scene.nodes.map((nd) => [nd.id, nd.label]));
  const contentW = Math.max(scene.width, 560);
  const bandH = opts.legend === false && !opts.titleBlock ? 0 : LEGEND_H;
  const width = Math.max(contentW + MARGIN * 2, BLOCK_W + 260 + MARGIN * 2);
  const height = scene.height + MARGIN * 2 + bandH + 14;
  const ox = MARGIN;
  const oy = MARGIN;

  const parts: string[] = [];
  parts.push(
    `<defs>` +
      `<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${t.ink3}" stroke-width="1" opacity="0.45"/></pattern>` +
      `<pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="${t.grid}" stroke-width="0.5"/></pattern>` +
      (["high", "medium", "low"] as const).map((c) => `<marker id="arrow-${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9" fill="none" stroke="${t.ink2}" stroke-width="1.4"/></marker>`).join("") +
    `</defs>`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${t.paper}"/>`);
  if (opts.grid !== false) parts.push(`<rect x="${ox}" y="${oy}" width="${n(contentW)}" height="${n(scene.height)}" fill="url(#grid)"/>`);

  const body: string[] = [];
  for (const s of scene.scopes) {
    body.push(
      `<g class="scope"><rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" fill="url(#hatch)" stroke="${t.ink3}" stroke-width="1" stroke-dasharray="6 4"/>` +
        `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(Math.min(s.w, s.name.length * 6.6 + 18))}" height="18" fill="${t.paperRaised}" stroke="${t.ink3}" stroke-width="1"/>` +
        `<text x="${n(s.x + 8)}" y="${n(s.y + 12.5)}" font-family="${COND}" font-size="10" letter-spacing="1" font-weight="600" fill="${t.ink}">${esc(s.name.toUpperCase())}</text></g>`
    );
  }
  const placed: Rect[] = [];
  for (const nd of scene.nodes) {
    placed.push({ x: nd.x, y: nd.y - (nd.public ? 17 : 0), w: nd.w, h: nd.h + (nd.public ? 17 : 0) });
    const count = nd.evidenced.length + nd.possible.length;
    if (count) placed.push({ x: nd.x + nd.w - count * 44, y: nd.y + nd.h + 4, w: count * 44, h: 14 });
  }
  for (const e of scene.edges) body.push(renderEdge(e, t, names, interactive, placed));
  for (const nd of scene.nodes) body.push(renderNode(nd, t, interactive));
  parts.push(`<g transform="translate(${ox} ${oy})">${body.join("")}</g>`);

  if (scene.emptyReason) {
    parts.push(`<text x="${ox + 8}" y="${oy + 60}" font-family="${SANS}" font-size="14" fill="${t.ink2}">${esc(scene.emptyReason)}</text>`);
  }

  const bandY = oy + scene.height + 14;
  if (opts.legend !== false) parts.push(legendSvg(t, ox, bandY));
  if (opts.titleBlock) parts.push(titleBlockSvg(opts.titleBlock, t, width - MARGIN - BLOCK_W, bandY));

  const title = `${scene.title}${opts.titleBlock ? `: ${opts.titleBlock.repo}` : ""}`;
  const idp = opts.idPrefix ?? "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="${interactive ? "group" : "img"}" aria-labelledby="${idp}t ${idp}d"${opts.theme ? ` data-theme="${t.name}"` : ""}>` +
    `<title id="${idp}t">${esc(title)}</title>` +
    `<desc id="${idp}d">${esc(`${scene.nodes.length} elements and ${scene.edges.length} connections. ${scene.emptyReason ?? ""}`.trim())}</desc>` +
    parts.join("") +
    `</svg>`
  );
}

export const SVG_BAND = { MARGIN, BLOCK_W, BLOCK_H, LEGEND_H };
