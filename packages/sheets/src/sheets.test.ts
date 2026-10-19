import * as path from "node:path";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { scan } from "@trailmap/scanner";
import { buildVendorInventory, type DependencyGraph } from "@trailmap/graph";
import { buildEvidencePdf, latin1 } from "./pdf";
import { contrastRatio, DARK, LIGHT } from "./theme";
import { layoutScene, selectForSheet, sublabelFor } from "./layout";
import { esc, sceneToSvg } from "./svg";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => path.join(here, "..", "..", "scanner", "fixtures", name, "repo");
const T0 = "2026-01-01T00:00:00.000Z";
const scopes = [{ id: "s1", name: "PCI CDE", nodeIds: ["service:services/payments", "db:postgres"] }];

async function graphOf(name: string): Promise<DependencyGraph> {
  return scan({ rootDir: fx(name), scannedAt: T0, repoName: `acme/${name}` });
}

describe("design tokens", () => {
  it("meet WCAG AA (4.5:1) for text on paper in both themes", () => {
    for (const t of [LIGHT, DARK]) {
      for (const [name, color] of Object.entries({ ink: t.ink, ink2: t.ink2, ink3: t.ink3, verified: t.verified, danger: t.danger })) {
        expect(contrastRatio(color, t.paper), `${t.name} ${name} on paper`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color, t.paperRaised), `${t.name} ${name} on raised paper`).toBeGreaterThanOrEqual(4.5);
      }
      for (const [cls, color] of Object.entries(t.classColor)) {
        expect(contrastRatio(color, t.paperRaised), `${t.name} ${cls} stamp`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps ink readable on the highlighter fill", () => {
    expect(contrastRatio(LIGHT.ink, LIGHT.attention)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(DARK.paper, DARK.attention)).toBeGreaterThanOrEqual(7);
  });

  it("computes known ratios correctly", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("sheet selection", () => {
  it("system sheet shows containers, vendors and datastores but not internal packages by default", async () => {
    const g = await graphOf("ts-microservices");
    const { nodes } = selectForSheet(g, { kind: "system" });
    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["service:services/gateway", "db:postgres", "vendor:stripe"]));
    const lib = { ...g, nodes: [...g.nodes, { id: "lib:x", name: "x", type: "library" as const, language: "unknown" as const, port: null, endpoints: [], path: "x" }] };
    expect(selectForSheet(lib, { kind: "system" }).nodes.some((n) => n.id === "lib:x")).toBe(false);
    expect(selectForSheet(lib, { kind: "system", showLibraries: true }).nodes.some((n) => n.id === "lib:x")).toBe(true);
  });

  it("data-flow sheet keeps only connections that carry a class, optionally one class", async () => {
    const g = await graphOf("ts-microservices");
    const all = selectForSheet(g, { kind: "data-flow" });
    expect(all.edges.every((e) => (e.dataClasses ?? []).length > 0)).toBe(true);
    const pan = selectForSheet(g, { kind: "data-flow", dataClass: "PAN" });
    expect(pan.edges.every((e) => e.dataClasses!.some((t) => t.class === "PAN"))).toBe(true);
    expect(pan.edges.length).toBeLessThanOrEqual(all.edges.length);
  });

  it("network sheet is built from infrastructure code only", async () => {
    const g = await graphOf("terraform-aws");
    const { nodes, edges } = selectForSheet(g, { kind: "network" });
    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["internet", "tf:aws_lb.web", "tf:aws_ecs_service.api"]));
    expect(edges.length).toBeGreaterThan(0);
    const plain = await graphOf("ts-microservices");
    expect(selectForSheet(plain, { kind: "network" }).nodes.every((n) => n.id !== "service:services/gateway")).toBe(true);
  });

  it("filters by minimum confidence", async () => {
    const g = await graphOf("ts-microservices");
    const high = selectForSheet(g, { kind: "system", minConfidence: "high" });
    expect(high.edges.every((e) => e.confidence === "high")).toBe(true);
  });

  it("describes node types in plain words", () => {
    expect(sublabelFor({ id: "d", name: "d", type: "database", engine: "postgres", language: "unknown", port: null, endpoints: [], path: "" })).toBe("DATASTORE · POSTGRES");
  });
});

describe("layout", () => {
  it("places every node, routes every edge orthogonally and wraps scope members in a region", async () => {
    const g = await graphOf("ts-microservices");
    const scene = await layoutScene(g, { kind: "system", scopes });
    expect(scene.nodes.length).toBeGreaterThan(4);
    for (const nd of scene.nodes) expect(nd.x + nd.w).toBeLessThanOrEqual(scene.width + 1);
    for (const e of scene.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < e.points.length - 1; i++) {
        const a = e.points[i]!;
        const b = e.points[i + 1]!;
        expect(a.x === b.x || a.y === b.y, `edge ${e.id} segment ${i} is not axis-aligned`).toBe(true);
      }
    }
    const [region] = scene.scopes;
    expect(region).toMatchObject({ id: "s1", name: "PCI CDE" });
    for (const id of scopes[0]!.nodeIds) {
      const nd = scene.nodes.find((x) => x.id === id)!;
      expect(nd.x).toBeGreaterThanOrEqual(region!.x);
      expect(nd.y).toBeGreaterThanOrEqual(region!.y);
      expect(nd.x + nd.w).toBeLessThanOrEqual(region!.x + region!.w);
      expect(nd.y + nd.h).toBeLessThanOrEqual(region!.y + region!.h);
    }
  });

  it("marks boundary crossings, evidenced classes and drift highlights", async () => {
    const g = await graphOf("ts-microservices");
    const stripe = g.edges.find((e) => e.to === "vendor:stripe")!;
    const scene = await layoutScene(g, { kind: "system", scopes, highlightNodeIds: ["vendor:stripe"], highlightEdgeIds: [stripe.id!] });
    const e = scene.edges.find((x) => x.to === "vendor:stripe")!;
    expect(e.crossesScope).toBe(true);
    expect(e.evidenced).toContain("PAN");
    expect(e.highlighted).toBe(true);
    expect(e.cite).toMatch(/services\/payments\/src\/index\.ts:\d+/);
    expect(scene.nodes.find((n) => n.id === "vendor:stripe")!.highlighted).toBe(true);
    expect(scene.edges.find((x) => x.from === "service:services/gateway" && x.to === "service:services/orders")!.crossesScope).toBe(false);
  });

  it("is deterministic", async () => {
    const g = await graphOf("ts-microservices");
    const a = JSON.stringify(await layoutScene(g, { kind: "system", scopes }));
    const b = JSON.stringify(await layoutScene(g, { kind: "system", scopes }));
    expect(a).toBe(b);
  });

  it("explains an empty sheet instead of drawing nothing", async () => {
    const g = await graphOf("trap-repo");
    const net = await layoutScene(g, { kind: "network" });
    expect(net.nodes).toEqual([]);
    expect(net.emptyReason).toMatch(/Terraform/);
    expect((await layoutScene(g, { kind: "data-flow" })).emptyReason).toMatch(/data class/);
    expect(sceneToSvg(net)).toContain("Terraform");
  });

  it("lays out 300 nodes quickly enough to stay interactive", async () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `service:s${i}`, name: `s${i}`, type: "service" as const, language: "typescript" as const, port: null, endpoints: [], path: `s${i}` }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: nodes[Math.floor(i / 3)]!.id, to: n.id, type: "http" as const, confidence: "high" as const }));
    const g: DependencyGraph = { meta: { repo: "big", scanned_at: T0, language_breakdown: {}, total_files: 1 }, nodes, edges };
    const t0 = Date.now();
    const scene = await layoutScene(g, { kind: "system" });
    expect(scene.nodes).toHaveLength(300);
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 30_000);
});

describe("SVG", () => {
  const block = { repo: "acme/shop", commit: "abc1234def56", date: "2026-01-01", sheet: 1, sheets: 3, sheetTitle: "System architecture", preparedBy: "kay", reviewedBy: null, graphHash: "f".repeat(64), scannerVersion: "0.2.0" };

  it("contains the title block, legend, stamps and encodes confidence by stroke", async () => {
    const g = await graphOf("ts-microservices");
    const scene = await layoutScene(g, { kind: "system", scopes });
    const svg = sceneToSvg(scene, { titleBlock: block });
    expect(svg.startsWith("<svg ")).toBe(true);
    for (const needle of ["acme/shop", "abc1234def56", "1 of 3: System architecture", "not reviewed", "f".repeat(64), "KEY", "PCI CDE", "PAN", "BOUNDARY", "url(#hatch)"]) {
      expect(svg, needle).toContain(needle);
    }
    expect(svg).toContain('data-confidence="high"');
  });

  it("is byte-identical for the same input and differs per theme", async () => {
    const g = await graphOf("go-kafka-redis");
    const scene = await layoutScene(g, { kind: "system" });
    expect(sceneToSvg(scene, { titleBlock: block, theme: LIGHT })).toBe(sceneToSvg(scene, { titleBlock: block, theme: LIGHT }));
    expect(sceneToSvg(scene, { theme: DARK })).toContain(DARK.paper);
    expect(sceneToSvg(scene, { theme: LIGHT })).not.toContain(DARK.paper);
  });

  it("adds focusable, labelled elements only for the interactive viewer", async () => {
    const g = await graphOf("go-kafka-redis");
    const scene = await layoutScene(g, { kind: "system" });
    const live = sceneToSvg(scene, { interactive: true });
    expect(live).toMatch(/data-node-id="service:\."[^>]*tabindex="0"[^>]*aria-label=/);
    expect(live).toMatch(/data-edge-id="[^"]+"[^>]*aria-label="database connection/);
    expect(sceneToSvg(scene)).not.toContain("tabindex");
  });

  it("escapes markup in names", () => {
    expect(esc('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

/** Text drawn with standard fonts is stored as hex strings in Flate-compressed content streams. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(t[1]!, "hex").toString("latin1") + "\n";
  }
  return out;
}

describe("PDF evidence pack", () => {
  async function input(): Promise<Parameters<typeof buildEvidencePdf>[0]> {
    const g = await graphOf("ts-microservices");
    const scenes = await Promise.all((["system", "data-flow", "network"] as const).map((kind) => layoutScene(g, { kind, scopes })));
    return {
      repo: "acme/shop", commit: "abc1234def56", date: "2026-01-01T00:00:00.000Z", graphHash: g.meta.graphHash!, scannerVersion: "0.2.0",
      framework: { name: "PCI DSS", version: "4.0.1", disclaimer: "Evidence to support an assessment. Not a certification.", requirements: [{ id: "1.2.4", title: "Data-flow diagram", summary: "s", verify: "Check the possible flows." }] },
      preparedBy: "kay", reviewedBy: "lee", period: { start: "2025-10-01", end: "2026-09-30" }, scenes,
      vendors: buildVendorInventory(g, [{ id: "stripe", name: "Stripe", category: "payments", website: "https://stripe.com" }]),
      graph: g, revisions: [{ label: "Rev A", date: "2026-01-01", commit: "abc1234def56", graphHash: g.meta.graphHash!, summary: "Initial scan" }],
      overrides: [{ kind: "hide_edge", reason: "false positive", actor: "kay", createdAt: "2026-01-02T00:00:00Z" }],
      attestations: [{ kind: "snapshot_review", actor: "lee", note: "Q1 review", createdAt: "2026-01-03T00:00:00Z", graphHash: g.meta.graphHash! }],
    };
  }

  it("produces a valid multi-page PDF whose title blocks count the pages", async () => {
    const bytes = await buildEvidencePdf(await input());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(8);
    expect(doc.getTitle()).toBe("PCI DSS evidence: acme/shop");
    const text = pdfText(bytes);
    expect(text).toContain(`1 of ${doc.getPageCount()}: Cover`);
    expect(text).toContain(`${doc.getPageCount()} of ${doc.getPageCount()}`);
  });

  it("contains selectable text: title block, full graph hash, vendors, revisions and the evidence appendix", async () => {
    const inp = await input();
    const text = pdfText(await buildEvidencePdf(inp));
    for (const needle of ["acme/shop", "abc1234def56", "GRAPH HASH", inp.graphHash, "lee", "Vendor and subprocessor inventory", "Stripe", "Revision log", "Rev A", "Evidence appendix", "services/payments/src/index.ts", "Verify: Check the possible flows."]) {
      expect(text, needle).toContain(needle);
    }
    expect(text.split(inp.graphHash).length - 1).toBeGreaterThanOrEqual(8);
  });

  it("is deterministic: the same input gives the same bytes", async () => {
    const inp = await input();
    const a = Buffer.from(await buildEvidencePdf(inp));
    const b = Buffer.from(await buildEvidencePdf(inp));
    expect(a.equals(b)).toBe(true);
  });

  it("restricts text to what standard fonts can encode", () => {
    expect(latin1("café → ok …")).toBe("café ? ok ...");
  });
});
