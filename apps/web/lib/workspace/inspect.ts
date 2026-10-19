import type { Confidence, DataClass, DependencyGraph, GraphEvidence, Scope } from "@trailmap/graph";

export interface TagView {
  class: DataClass;
  certainty: "evidenced" | "possible";
  evidence: GraphEvidence[];
}

export interface LinkView {
  edgeId: string;
  otherId: string;
  otherName: string;
  type: string;
  confidence: Confidence;
}

export interface NodeView {
  id: string;
  name: string;
  type: string;
  path: string;
  language: string;
  framework: string | null;
  engine: string | null;
  vendor: string | null;
  public: boolean;
  port: number | null;
  techStack: string[];
  evidence: GraphEvidence[];
  dataClasses: TagView[];
  exposure: Array<{ direction: string; cidr: string; port: number | null; protocol: string | null; source: string; line: number | null }>;
  inbound: LinkView[];
  outbound: LinkView[];
  scopes: string[];
}

export interface EdgeView {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  type: string;
  confidence: Confidence;
  evidence: GraphEvidence[];
  dataClasses: TagView[];
}

export interface InspectorIndex {
  nodes: Record<string, NodeView>;
  edges: Record<string, EdgeView>;
}

/** The scene uses the stored edge id, or from>to:type for snapshots written before ids existed. */
export const sceneEdgeId = (e: { id?: string; from: string; to: string; type: string }) => e.id ?? `${e.from}>${e.to}:${e.type}`;

/** Plain-data lookup of everything the inspector shows, so the browser never needs the graph library. */
export function buildInspectorIndex(graph: DependencyGraph, scopes: Scope[]): InspectorIndex {
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const edges: Record<string, EdgeView> = {};
  const inbound = new Map<string, LinkView[]>();
  const outbound = new Map<string, LinkView[]>();
  for (const e of graph.edges) {
    const id = sceneEdgeId(e);
    edges[id] = {
      id, from: e.from, fromName: names.get(e.from) ?? e.from, to: e.to, toName: names.get(e.to) ?? e.to, type: e.type, confidence: e.confidence,
      evidence: e.evidence ?? [], dataClasses: (e.dataClasses ?? []).map((t) => ({ class: t.class, certainty: t.certainty, evidence: t.evidence })),
    };
    const push = (m: Map<string, LinkView[]>, key: string, v: LinkView) => m.set(key, [...(m.get(key) ?? []), v]);
    push(outbound, e.from, { edgeId: id, otherId: e.to, otherName: names.get(e.to) ?? e.to, type: e.type, confidence: e.confidence });
    push(inbound, e.to, { edgeId: id, otherId: e.from, otherName: names.get(e.from) ?? e.from, type: e.type, confidence: e.confidence });
  }
  const nodes: Record<string, NodeView> = {};
  for (const n of graph.nodes) {
    nodes[n.id] = {
      id: n.id, name: n.name, type: n.type, path: n.path, language: n.language, framework: n.framework ?? null, engine: n.engine ?? null,
      vendor: n.vendor ?? null, public: Boolean(n.public), port: n.port, techStack: n.techStack ?? [], evidence: n.evidence ?? [],
      dataClasses: (n.dataClasses ?? []).map((t) => ({ class: t.class, certainty: t.certainty, evidence: t.evidence })),
      exposure: (n.exposure ?? []).map((x) => ({ direction: x.direction, cidr: x.cidr, port: x.port, protocol: x.protocol ?? null, source: x.source, line: x.line ?? null })),
      inbound: inbound.get(n.id) ?? [], outbound: outbound.get(n.id) ?? [],
      scopes: scopes.filter((s) => s.nodeIds.includes(n.id)).map((s) => s.name),
    };
  }
  return { nodes, edges };
}
