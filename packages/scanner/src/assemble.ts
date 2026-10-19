import {
  computeGraphHash,
  stableId,
  GRAPH_SCHEMA_VERSION,
  type Confidence,
  type DataClass,
  type DataClassTag,
  type DependencyGraph,
  type EdgeType,
  type EvidenceKind,
  type GraphEdge,
  type GraphEvidence,
  type GraphNode,
} from "@trailmap/graph";

export const SCANNER_VERSION = "0.2.0";

/** Independent kinds of proof that can back an edge. Used to decide confidence. */
export type Signal =
  | "sdk-import"   // an SDK / driver import in code
  | "env-read"     // code reads an env var that belongs to the target
  | "http-call"    // a literal URL in an HTTP client call
  | "http-weak"    // a URL constant not directly in a call
  | "connstring"   // a connection-string literal in code or config
  | "iac"          // deploy/IaC config sets something that points at the target
  | "iac-ref"      // IaC explicitly references the target resource
  | "compose"      // docker-compose depends_on
  | "import"       // import of another package in this repo
  | "call-site"    // an SDK call that handles a data class
  | "dependency"   // declared in a manifest, no usage seen
  | "declared";    // listed in an example env file; proves nothing at runtime

const STRONG_SINGLE_HIGH = new Set<Signal>(["connstring", "http-call", "import", "iac-ref"]);

export function confidenceFor(signals: Set<Signal>): Confidence | null {
  const strong = [...signals].filter((s) => s !== "declared" && s !== "dependency");
  if (strong.length >= 2) return "high";
  if (strong.length === 1) return STRONG_SINGLE_HIGH.has(strong[0]!) ? "high" : "medium";
  if (signals.has("dependency")) return "low";
  return null; // only "declared": never creates an edge
}

export interface TagBuild {
  class: DataClass;
  certainty: "evidenced" | "possible";
  evidence: GraphEvidence[];
}

interface EdgeBuild {
  from: string;
  to: string;
  type: EdgeType;
  signals: Set<Signal>;
  evidence: GraphEvidence[];
  tags: Map<DataClass, TagBuild>;
}

const MAX_EVIDENCE = 25;

function evKey(e: GraphEvidence): string {
  return `${e.kind}|${e.source}|${e.line ?? 0}|${e.detail}`;
}

export function mergeEvidence(into: GraphEvidence[], more: GraphEvidence[]): GraphEvidence[] {
  const seen = new Set(into.map(evKey));
  for (const e of more) {
    const k = evKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      into.push(e);
    }
  }
  return into;
}

function sortEvidence(list: GraphEvidence[]): GraphEvidence[] {
  return [...list].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.kind.localeCompare(b.kind) ||
      a.detail.localeCompare(b.detail)
  );
}

export class GraphBuilder {
  readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, EdgeBuild>();

  addNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, node);
      return node;
    }
    if (!existing.port && node.port) existing.port = node.port;
    if (!existing.framework && node.framework) existing.framework = node.framework;
    if (!existing.vendor && node.vendor) existing.vendor = node.vendor;
    if (!existing.engine && node.engine) existing.engine = node.engine;
    if ((!existing.path || existing.path === "") && node.path) existing.path = node.path;
    if (node.public) existing.public = true;
    existing.endpoints = [...new Set([...existing.endpoints, ...node.endpoints])].sort();
    existing.techStack = node.techStack || existing.techStack
      ? [...new Set([...(existing.techStack ?? []), ...(node.techStack ?? [])])].sort()
      : undefined;
    existing.evidence = mergeEvidence(existing.evidence ?? [], node.evidence ?? []);
    if (node.exposure?.length) existing.exposure = [...(existing.exposure ?? []), ...node.exposure];
    if (node.iac && !existing.iac) existing.iac = node.iac;
    return existing;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  addEdge(from: string, to: string, type: EdgeType, signal: Signal, evidence: GraphEvidence[]): void {
    if (from === to) return;
    const key = `${from}\u0000${to}\u0000${type}`;
    let e = this.edges.get(key);
    if (!e) {
      e = { from, to, type, signals: new Set(), evidence: [], tags: new Map() };
      this.edges.set(key, e);
    }
    e.signals.add(signal);
    mergeEvidence(e.evidence, evidence);
  }

  addEdgeTag(from: string, to: string, type: EdgeType, tag: TagBuild): void {
    const e = this.edges.get(`${from}\u0000${to}\u0000${type}`);
    if (!e) return;
    const cur = e.tags.get(tag.class);
    if (!cur) {
      e.tags.set(tag.class, { ...tag, evidence: [...tag.evidence] });
      return;
    }
    if (tag.certainty === "evidenced") cur.certainty = "evidenced";
    mergeEvidence(cur.evidence, tag.evidence);
  }

  hasEdge(from: string, to: string, type: EdgeType): boolean {
    return this.edges.has(`${from}\u0000${to}\u0000${type}`);
  }

  edgesFrom(from: string): Array<{ to: string; type: EdgeType }> {
    return [...this.edges.values()].filter((e) => e.from === from).map((e) => ({ to: e.to, type: e.type }));
  }

  /** Re-point every edge touching `fromId` at `toId` (used to merge duplicate nodes). */
  rewire(fromId: string, toId: string): void {
    const moved = [...this.edges.entries()].filter(([, e]) => e.from === fromId || e.to === fromId);
    for (const [key, e] of moved) {
      this.edges.delete(key);
      const from = e.from === fromId ? toId : e.from;
      const to = e.to === fromId ? toId : e.to;
      if (from === to) continue;
      const nk = `${from}\u0000${to}\u0000${e.type}`;
      const into = this.edges.get(nk);
      if (!into) {
        this.edges.set(nk, { ...e, from, to });
      } else {
        for (const s of e.signals) into.signals.add(s);
        mergeEvidence(into.evidence, e.evidence);
        for (const t of e.tags.values()) {
          const cur = into.tags.get(t.class);
          if (!cur) into.tags.set(t.class, t);
          else {
            if (t.certainty === "evidenced") cur.certainty = "evidenced";
            mergeEvidence(cur.evidence, t.evidence);
          }
        }
      }
    }
  }

  mergeNodeInto(fromId: string, toId: string): void {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to || fromId === toId) return;
    this.addNode({ ...from, id: toId });
    this.nodes.delete(fromId);
    this.rewire(fromId, toId);
  }

  build(meta: {
    repo: string;
    scannedAt: string;
    languageBreakdown: Record<string, number>;
    totalFiles: number;
  }): DependencyGraph {
    const edges: GraphEdge[] = [];
    for (const e of this.edges.values()) {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) continue;
      const confidence = confidenceFor(e.signals);
      if (!confidence) continue;
      const edge: GraphEdge = {
        id: stableId("e", e.from, e.to, e.type),
        from: e.from,
        to: e.to,
        type: e.type,
        confidence,
        evidence: sortEvidence(e.evidence).slice(0, MAX_EVIDENCE),
      };
      if (e.tags.size) edge.dataClasses = tagList(e.tags);
      edges.push(edge);
    }
    edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));

    const connected = new Set<string>();
    for (const e of edges) { connected.add(e.from); connected.add(e.to); }

    const nodes = [...this.nodes.values()]
      .map((n) => {
        const out: GraphNode = { ...n, endpoints: [...n.endpoints].sort() };
        if (out.evidence) out.evidence = sortEvidence(out.evidence).slice(0, MAX_EVIDENCE);
        if (out.exposure) {
          out.exposure = [...out.exposure].sort(
            (a, b) => a.source.localeCompare(b.source) || (a.line ?? 0) - (b.line ?? 0) || a.cidr.localeCompare(b.cidr) || (a.port ?? 0) - (b.port ?? 0)
          );
        }
        for (const key of Object.keys(out) as Array<keyof GraphNode>) if (out[key] === undefined) delete out[key];
        return out;
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    // Roll data classes up from edges onto the datastores / vendors they point at.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      if (!e.dataClasses) continue;
      const target = byId.get(e.to);
      if (!target || target.type === "service" || target.type === "library") continue;
      const tags = new Map<DataClass, TagBuild>((target.dataClasses ?? []).map((t) => [t.class, { ...t, evidence: [...t.evidence] }]));
      for (const t of e.dataClasses) {
        const cur = tags.get(t.class);
        if (!cur) tags.set(t.class, { ...t, evidence: [...t.evidence] });
        else {
          if (t.certainty === "evidenced") cur.certainty = "evidenced";
          mergeEvidence(cur.evidence, t.evidence);
        }
      }
      target.dataClasses = tagList(tags);
    }

    const graph: DependencyGraph = {
      meta: {
        repo: meta.repo,
        scanned_at: meta.scannedAt,
        language_breakdown: Object.fromEntries(Object.entries(meta.languageBreakdown).sort(([a], [b]) => a.localeCompare(b))),
        total_files: meta.totalFiles,
        graphSchemaVersion: GRAPH_SCHEMA_VERSION,
        scannerVersion: SCANNER_VERSION,
      },
      nodes,
      edges,
    };
    graph.meta.graphHash = computeGraphHash(graph);
    return graph;
  }
}

function tagList(tags: Map<DataClass, TagBuild>): DataClassTag[] {
  return [...tags.values()]
    .map((t) => ({ class: t.class, certainty: t.certainty, evidence: sortEvidence(t.evidence).slice(0, 8) }))
    .sort((a, b) => a.class.localeCompare(b.class));
}

export function ev(
  kind: EvidenceKind,
  source: string,
  detail: string,
  line?: number,
  snippet?: string
): GraphEvidence {
  const e: GraphEvidence = { kind, source, detail };
  if (line !== undefined) e.line = line;
  if (snippet) e.snippet = snippet;
  return e;
}
