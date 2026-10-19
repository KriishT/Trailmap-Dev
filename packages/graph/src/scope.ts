import type { DataClass, DependencyGraph, GraphEdge, GraphNode } from "./schema.js";
import { edgeKey } from "./diff.js";

/** A named compliance scope: the set of nodes whose security posture an assessor cares about. */
export interface Scope {
  id: string;
  name: string;
  nodeIds: string[];
}

export interface BoundaryCrossing {
  edge: GraphEdge;
  /** The endpoint inside the scope. */
  inside: GraphNode;
  /** The endpoint outside it. */
  outside: GraphNode;
  /** `out`: scope node calls out; `in`: something outside calls into the scope. */
  direction: "in" | "out";
}

export interface ScopeAnalysis {
  scope: Scope;
  /** Nodes in the scope that exist in the graph. */
  members: GraphNode[];
  /** Scope node ids that no longer exist in the graph. */
  missing: string[];
  crossings: BoundaryCrossing[];
  /** Nodes outside the scope that are directly connected to it (the "connected-to" set). */
  connectedTo: GraphNode[];
}

export function analyzeScope(graph: DependencyGraph, scope: Scope): ScopeAnalysis {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inScope = new Set(scope.nodeIds);
  const members = scope.nodeIds.map((id) => byId.get(id)).filter((n): n is GraphNode => !!n);
  const missing = scope.nodeIds.filter((id) => !byId.has(id));

  const crossings: BoundaryCrossing[] = [];
  const connected = new Map<string, GraphNode>();
  for (const edge of graph.edges) {
    const fromIn = inScope.has(edge.from);
    const toIn = inScope.has(edge.to);
    if (fromIn === toIn) continue;
    const inside = byId.get(fromIn ? edge.from : edge.to);
    const outside = byId.get(fromIn ? edge.to : edge.from);
    if (!inside || !outside) continue;
    crossings.push({ edge, inside, outside, direction: fromIn ? "out" : "in" });
    connected.set(outside.id, outside);
  }
  crossings.sort((a, b) => edgeKey(a.edge).localeCompare(edgeKey(b.edge)));

  return {
    scope,
    members,
    missing,
    crossings,
    connectedTo: [...connected.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Suggest the nodes that belong in a scope for a data class: every node that touches it,
 * evidenced or not, plus the datastores they write to. A starting point for the scope editor.
 */
export function suggestScope(graph: DependencyGraph, dataClass: DataClass): string[] {
  const ids = new Set<string>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const edge of graph.edges) {
    if (!(edge.dataClasses ?? []).some((t) => t.class === dataClass)) continue;
    ids.add(edge.from);
    ids.add(edge.to);
  }
  for (const node of graph.nodes) {
    if ((node.dataClasses ?? []).some((t) => t.class === dataClass)) ids.add(node.id);
  }
  return [...ids].filter((id) => byId.has(id) && id !== "internet").sort();
}

/** Edges that carry a data class, for the data-flow view. */
export function dataFlows(graph: DependencyGraph, dataClass: DataClass): GraphEdge[] {
  return graph.edges.filter((e) => (e.dataClasses ?? []).some((t) => t.class === dataClass));
}
