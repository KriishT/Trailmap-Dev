import ElkBundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi, ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import type { Confidence, DataClass, DependencyGraph, GraphEdge, GraphNode } from "@trailmap/graph";
import { CLASS_PRIORITY } from "./theme.js";
import { SHEET_TITLES, type Point, type Scene, type SceneEdge, type SceneNode, type SceneScope, type SheetOptions } from "./types.js";

// elkjs is CommonJS; depending on the bundler the constructor is the module or its default export.
type ElkConstructor = new () => ElkApi;
const ELK: ElkConstructor = ((ElkBundled as unknown as { default?: ElkConstructor }).default ?? (ElkBundled as unknown as ElkConstructor));

const CONF_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
const NODE_H = 48;
const CHAR_W = 7.4; // IBM Plex Mono at 12px
const MIN_W = 132;
const MAX_W = 260;
const SCOPE_PAD = { top: 30, left: 18, bottom: 18, right: 18 };

const TYPE_WORD: Record<GraphNode["type"], string> = {
  service: "SERVICE", library: "LIBRARY", external: "EXTERNAL HOST", database: "DATASTORE", saas: "VENDOR",
  queue: "QUEUE", storage: "OBJECT STORE", function: "FUNCTION", loadbalancer: "LOAD BALANCER", network: "NETWORK",
};

export function sublabelFor(n: GraphNode): string {
  const word = TYPE_WORD[n.type];
  const detail = n.engine ?? (n.type === "saas" ? n.vendor : undefined) ?? n.framework;
  return detail ? `${word} · ${detail.toUpperCase()}` : word;
}

const round = (v: number) => Math.round(v * 2) / 2;

/** The nodes and edges that belong on a sheet. */
export function selectForSheet(graph: DependencyGraph, opts: SheetOptions): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const min = CONF_RANK[opts.minConfidence ?? "low"];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let edges = graph.edges.filter((e) => CONF_RANK[e.confidence] >= min && byId.has(e.from) && byId.has(e.to));
  let keep: (n: GraphNode) => boolean;

  if (opts.kind === "system") {
    // Containers: what runs, what stores, who is called. Network plumbing and internal packages stay off this sheet.
    keep = (n) => n.type !== "network" && n.type !== "loadbalancer" && (opts.showLibraries || n.type !== "library");
    edges = edges.filter((e) => e.type !== "network" && (opts.showLibraries || e.type !== "import"));
  } else if (opts.kind === "data-flow") {
    edges = edges.filter((e) => (e.dataClasses ?? []).some((t) => !opts.dataClass || t.class === opts.dataClass));
    keep = () => true;
  } else {
    // Network: internet -> entry points -> services -> datastores, from infrastructure code.
    const netTypes = new Set<GraphNode["type"]>(["network", "loadbalancer"]);
    const iacNodes = new Set(graph.nodes.filter((n) => n.iac || netTypes.has(n.type) || n.public).map((n) => n.id));
    edges = edges.filter((e) => e.type === "network" || (iacNodes.has(e.from) && iacNodes.has(e.to)));
    keep = (n) => iacNodes.has(n.id);
  }

  const connected = new Set<string>();
  for (const e of edges) { connected.add(e.from); connected.add(e.to); }
  // On the flow and network sheets only connected nodes are interesting; on the system sheet keep every container.
  const nodes = graph.nodes.filter((n) => keep(n) && (opts.kind === "system" || connected.has(n.id) || (opts.kind === "network" && n.public)));
  const ids = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges].sort((a, b) => (a.id ?? `${a.from}>${a.to}`).localeCompare(b.id ?? `${b.from}>${b.to}`)) };
}

function widthFor(label: string, sub: string): number {
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(Math.max(label.length * CHAR_W, sub.length * 6.4)) + 28));
}

function classesOf(tags: GraphEdge["dataClasses"], certainty: "evidenced" | "possible"): DataClass[] {
  return CLASS_PRIORITY.filter((c) => (tags ?? []).some((t) => t.class === c && t.certainty === certainty));
}

const CITE_RANK: Record<string, number> = {
  "call-site": 0, "sdk-import": 1, "http-call": 2, env: 3, schema: 4, iac: 5, terraform: 5, cloudformation: 5,
  compose: 6, kubernetes: 6, helm: 6, import: 7, manual: 8, dependency: 9, declared: 10,
};

/** The most direct piece of evidence as `file:line`: a call or import in code beats a deploy or manifest line. */
function citeOf(e: GraphEdge): string | null {
  const ranked = [...(e.evidence ?? [])].sort((a, b) => (CITE_RANK[a.kind] ?? 9) - (CITE_RANK[b.kind] ?? 9) || a.source.localeCompare(b.source) || (a.line ?? 0) - (b.line ?? 0));
  const ev = ranked.find((x) => x.line) ?? ranked[0];
  return ev ? `${ev.source}${ev.line ? `:${ev.line}` : ""}` : null;
}

interface Placed { x: number; y: number }

/**
 * Lay a sheet out with ELK (layered, orthogonal routing). Scopes become compound nodes so their
 * hatched regions enclose their members. The result is plain data, deterministic for a given input,
 * and is the single source for the on-screen SVG, the exported SVG and the PDF.
 */
export async function layoutScene(graph: DependencyGraph, opts: SheetOptions): Promise<Scene> {
  const { nodes, edges } = selectForSheet(graph, opts);
  const title = opts.kind === "data-flow" && opts.dataClass ? `${SHEET_TITLES["data-flow"]}: ${opts.dataClass}` : SHEET_TITLES[opts.kind];
  if (nodes.length === 0) {
    const reason =
      opts.kind === "network" ? "No infrastructure code was found, so there is no network sheet. Add Terraform, CloudFormation, Kubernetes or Helm files."
      : opts.kind === "data-flow" ? "No connection carries a data class yet. Data classes come from database schemas and vendor SDK calls."
      : "No services were detected in this snapshot.";
    return { kind: opts.kind, title, width: 640, height: 200, nodes: [], edges: [], scopes: [], emptyReason: reason };
  }

  const highlightN = new Set(opts.highlightNodeIds ?? []);
  const highlightE = new Set(opts.highlightEdgeIds ?? []);
  const scopes = opts.scopes ?? [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const scopeOf = new Map<string, string>();
  for (const s of scopes) for (const id of s.nodeIds) if (nodeIds.has(id) && !scopeOf.has(id)) scopeOf.set(id, s.id);
  const inAny = new Set(scopes.flatMap((s) => s.nodeIds));

  const sceneNodes = new Map<string, SceneNode>();
  const elkLeaf = (n: GraphNode): ElkNode => {
    const label = n.name;
    const sub = sublabelFor(n);
    const evidenced = new Set<DataClass>();
    const possible = new Set<DataClass>();
    for (const t of n.dataClasses ?? []) (t.certainty === "evidenced" ? evidenced : possible).add(t.class);
    for (const e of edges) {
      if (e.to === n.id || e.from === n.id) {
        for (const t of e.dataClasses ?? []) (t.certainty === "evidenced" ? evidenced : possible).add(t.class);
      }
    }
    for (const c of evidenced) possible.delete(c);
    const w = widthFor(label, sub);
    sceneNodes.set(n.id, {
      id: n.id, label, sublabel: sub, type: n.type, x: 0, y: 0, w, h: NODE_H, public: Boolean(n.public),
      highlighted: highlightN.has(n.id), evidenced: CLASS_PRIORITY.filter((c) => evidenced.has(c)), possible: CLASS_PRIORITY.filter((c) => possible.has(c)),
      scopeId: scopeOf.get(n.id) ?? null, inAnyScope: inAny.has(n.id),
    });
    return { id: n.id, width: w, height: NODE_H };
  };

  const children: ElkNode[] = [];
  const groups = new Map<string, ElkNode>();
  for (const s of scopes) {
    const members = nodes.filter((n) => scopeOf.get(n.id) === s.id);
    if (!members.length) continue;
    const group: ElkNode = {
      id: `scope:${s.id}`,
      layoutOptions: { "elk.padding": `[top=${SCOPE_PAD.top},left=${SCOPE_PAD.left},bottom=${SCOPE_PAD.bottom},right=${SCOPE_PAD.right}]` },
      children: members.map(elkLeaf),
    };
    groups.set(s.id, group);
    children.push(group);
  }
  for (const n of nodes) if (!scopeOf.has(n.id)) children.push(elkLeaf(n));

  const elkEdges: ElkExtendedEdge[] = edges.map((e, i) => ({ id: `${i}`, sources: [e.from], targets: [e.to] }));
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.edgeNode": "18",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children,
    edges: elkEdges,
  };

  const out = await new ELK().layout(root);

  // Absolute positions: children are relative to their parent.
  const abs = new Map<string, Placed>();
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const c of node.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      abs.set(c.id, { x, y });
      walk(c, x, y);
    }
  };
  walk(out, 0, 0);

  for (const [id, sn] of sceneNodes) {
    const p = abs.get(id)!;
    sn.x = round(p.x);
    sn.y = round(p.y);
  }

  const sceneScopes: SceneScope[] = [];
  for (const s of scopes) {
    const g = groups.get(s.id);
    const p = g ? abs.get(g.id) : undefined;
    const placed = out.children?.find((c) => c.id === `scope:${s.id}`) ?? findById(out, `scope:${s.id}`);
    if (!g || !p || !placed) continue;
    sceneScopes.push({ id: s.id, name: s.name, x: round(p.x), y: round(p.y), w: round(placed.width ?? 0), h: round(placed.height ?? 0) });
  }

  const scopeSet = new Map(scopes.map((s) => [s.id, new Set(s.nodeIds)]));
  const sceneEdges: SceneEdge[] = [];
  edges.forEach((e, i) => {
    const elkEdge = (out.edges ?? []).concat(collectEdges(out)).find((x) => x.id === `${i}`) as (ElkExtendedEdge & { container?: string }) | undefined;
    const section = elkEdge?.sections?.[0];
    const offset = elkEdge?.container && elkEdge.container !== "root" ? (abs.get(elkEdge.container) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const pts: Point[] = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: round(p.x + offset.x), y: round(p.y + offset.y) }))
      : fallbackPoints(sceneNodes.get(e.from)!, sceneNodes.get(e.to)!);
    let crosses = false;
    for (const members of scopeSet.values()) if (members.has(e.from) !== members.has(e.to)) crosses = true;
    sceneEdges.push({
      id: e.id ?? `${e.from}>${e.to}:${e.type}`, from: e.from, to: e.to, type: e.type, confidence: e.confidence, points: pts,
      evidenced: classesOf(e.dataClasses, "evidenced"), possible: classesOf(e.dataClasses, "possible"),
      crossesScope: crosses, highlighted: highlightE.has(e.id ?? ""), cite: citeOf(e),
    });
  });

  return {
    kind: opts.kind, title, width: Math.ceil(out.width ?? 0), height: Math.ceil(out.height ?? 0),
    nodes: [...sceneNodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: sceneEdges, scopes: sceneScopes, emptyReason: null,
  };
}

function findById(node: ElkNode, id: string): ElkNode | undefined {
  for (const c of node.children ?? []) {
    if (c.id === id) return c;
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return undefined;
}

function collectEdges(node: ElkNode): ElkExtendedEdge[] {
  const out: ElkExtendedEdge[] = [];
  for (const c of node.children ?? []) {
    out.push(...(c.edges ?? []), ...collectEdges(c));
  }
  return out;
}

function fallbackPoints(a: SceneNode, b: SceneNode): Point[] {
  return [{ x: round(a.x + a.w), y: round(a.y + a.h / 2) }, { x: round(b.x), y: round(b.y + b.h / 2) }];
}
