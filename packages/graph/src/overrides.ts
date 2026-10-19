import type { DataClass, DependencyGraph, EdgeType, GraphEdge } from "./schema.js";
import { edgeKey } from "./diff.js";
import { stableId } from "./hash.js";

interface Base {
  id: string;
  /** Free-text justification, required so an auditor can see why a human changed the picture. */
  reason: string;
  actor: string;
  createdAt: string;
}

export type Override = Base &
  (
    | { kind: "confirm_edge"; edgeId: string }
    | { kind: "hide_edge"; edgeId: string }
    | { kind: "add_edge"; from: string; to: string; edgeType: EdgeType }
    | { kind: "set_data_class"; target: { kind: "edge" | "node"; id: string }; class: DataClass; present: boolean }
    | { kind: "hide_node"; nodeId: string }
  );

export interface AppliedOverrides {
  /** The graph as it should be shown and exported: scanner output plus human decisions. */
  graph: DependencyGraph;
  applied: Override[];
  /** Overrides that no longer match anything (the node or edge disappeared). Reported, never silently dropped. */
  orphaned: Override[];
}

const byAge = (a: Override, b: Override) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Layer human decisions over scanner output. Overrides refer to stable node and edge ids, so
 * they keep applying to every later snapshot. The input graph is not modified.
 */
export function applyOverrides(base: DependencyGraph, overrides: Override[]): AppliedOverrides {
  const graph: DependencyGraph = JSON.parse(JSON.stringify(base)) as DependencyGraph;
  const applied: Override[] = [];
  const orphaned: Override[] = [];
  const manual = (o: Override, detail: string) => ({
    kind: "manual" as const,
    source: `override:${o.id}`,
    detail: `${detail} by ${o.actor}: ${o.reason}`,
  });

  for (const o of [...overrides].sort(byAge)) {
    const edgeIndex = (id: string) => graph.edges.findIndex((e) => edgeKey(e) === id);
    switch (o.kind) {
      case "confirm_edge": {
        const i = edgeIndex(o.edgeId);
        if (i === -1) { orphaned.push(o); break; }
        const e = graph.edges[i]!;
        e.confidence = "high";
        e.evidence = [...(e.evidence ?? []), manual(o, "Confirmed")];
        applied.push(o);
        break;
      }
      case "hide_edge": {
        const i = edgeIndex(o.edgeId);
        if (i === -1) { orphaned.push(o); break; }
        graph.edges.splice(i, 1);
        applied.push(o);
        break;
      }
      case "add_edge": {
        const ids = new Set(graph.nodes.map((n) => n.id));
        if (!ids.has(o.from) || !ids.has(o.to)) { orphaned.push(o); break; }
        const existing = graph.edges.find((e) => e.from === o.from && e.to === o.to && e.type === o.edgeType);
        if (existing) {
          existing.confidence = "high";
          existing.evidence = [...(existing.evidence ?? []), manual(o, "Added")];
        } else {
          const edge: GraphEdge = {
            id: stableId("e", o.from, o.to, o.edgeType),
            from: o.from, to: o.to, type: o.edgeType, confidence: "high",
            evidence: [manual(o, "Added manually")],
          };
          graph.edges.push(edge);
        }
        applied.push(o);
        break;
      }
      case "set_data_class": {
        const subject = o.target.kind === "edge"
          ? graph.edges.find((e) => edgeKey(e) === o.target.id)
          : graph.nodes.find((n) => n.id === o.target.id);
        if (!subject) { orphaned.push(o); break; }
        const tags = (subject.dataClasses ?? []).filter((t) => t.class !== o.class);
        if (o.present) tags.push({ class: o.class, certainty: "evidenced", evidence: [manual(o, `Marked as ${o.class}`)] });
        subject.dataClasses = tags.sort((a, b) => a.class.localeCompare(b.class));
        if (subject.dataClasses.length === 0) delete subject.dataClasses;
        applied.push(o);
        break;
      }
      case "hide_node": {
        const i = graph.nodes.findIndex((n) => n.id === o.nodeId);
        if (i === -1) { orphaned.push(o); break; }
        graph.nodes.splice(i, 1);
        graph.edges = graph.edges.filter((e) => e.from !== o.nodeId && e.to !== o.nodeId);
        applied.push(o);
        break;
      }
    }
  }

  graph.edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));
  return { graph, applied, orphaned };
}
