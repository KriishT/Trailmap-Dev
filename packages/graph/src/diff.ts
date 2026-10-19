import type { Confidence, DataClass, DependencyGraph, GraphEdge, GraphNode } from "./schema.js";

export interface NodeChange {
  id: string;
  before: GraphNode;
  after: GraphNode;
  /** Names of the fields that differ. */
  fields: string[];
}

export interface EdgeChange {
  id: string;
  edge: GraphEdge;
  before: Confidence;
  after: Confidence;
}

export interface DataClassChange {
  /** Edge id (or node id when the class sits on a node) that gained or lost the class. */
  subject: string;
  subjectKind: "edge" | "node";
  class: DataClass;
  certainty: "evidenced" | "possible";
}

export interface GraphDiff {
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  changedNodes: NodeChange[];
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
  changedEdges: EdgeChange[];
  addedDataClasses: DataClassChange[];
  removedDataClasses: DataClassChange[];
  isEmpty: boolean;
}

export const edgeKey = (e: Pick<GraphEdge, "id" | "from" | "to" | "type">): string =>
  e.id ?? `${e.from}>${e.to}:${e.type}`;

const COMPARED_NODE_FIELDS = ["name", "type", "engine", "vendor", "framework", "language", "port", "public"] as const;

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function tagSet(tags: GraphNode["dataClasses"] | GraphEdge["dataClasses"]): Map<DataClass, "evidenced" | "possible"> {
  return new Map((tags ?? []).map((t) => [t.class, t.certainty]));
}

function diffTags(
  subject: string,
  kind: "edge" | "node",
  before: Map<DataClass, "evidenced" | "possible">,
  after: Map<DataClass, "evidenced" | "possible">,
  added: DataClassChange[],
  removed: DataClassChange[]
) {
  for (const [cls, certainty] of after) {
    if (before.get(cls) !== certainty) added.push({ subject, subjectKind: kind, class: cls, certainty });
  }
  for (const [cls, certainty] of before) {
    if (!after.has(cls)) removed.push({ subject, subjectKind: kind, class: cls, certainty });
  }
}

/** Compare two graphs by stable ids. `base` is the older graph, `head` the newer. */
export function diffGraphs(base: DependencyGraph, head: DependencyGraph): GraphDiff {
  const baseNodes = new Map(base.nodes.map((n) => [n.id, n]));
  const headNodes = new Map(head.nodes.map((n) => [n.id, n]));
  const baseEdges = new Map(base.edges.map((e) => [edgeKey(e), e]));
  const headEdges = new Map(head.edges.map((e) => [edgeKey(e), e]));

  const diff: GraphDiff = {
    addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: [], removedEdges: [], changedEdges: [],
    addedDataClasses: [], removedDataClasses: [], isEmpty: true,
  };

  for (const [id, node] of headNodes) {
    const before = baseNodes.get(id);
    if (!before) { diff.addedNodes.push(node); continue; }
    const fields: string[] = COMPARED_NODE_FIELDS.filter((f) => stable(before[f]) !== stable(node[f])).map(String);
    if (stable(before.exposure) !== stable(node.exposure)) fields.push("exposure");
    if (fields.length) diff.changedNodes.push({ id, before, after: node, fields });
    diffTags(id, "node", tagSet(before.dataClasses), tagSet(node.dataClasses), diff.addedDataClasses, diff.removedDataClasses);
  }
  for (const [id, node] of baseNodes) if (!headNodes.has(id)) diff.removedNodes.push(node);

  for (const [key, edge] of headEdges) {
    const before = baseEdges.get(key);
    if (!before) { diff.addedEdges.push(edge); continue; }
    if (before.confidence !== edge.confidence) diff.changedEdges.push({ id: key, edge, before: before.confidence, after: edge.confidence });
    diffTags(key, "edge", tagSet(before.dataClasses), tagSet(edge.dataClasses), diff.addedDataClasses, diff.removedDataClasses);
  }
  for (const [key, edge] of baseEdges) if (!headEdges.has(key)) diff.removedEdges.push(edge);

  // A brand new edge carries its tags with it
  for (const edge of diff.addedEdges) {
    diffTags(edgeKey(edge), "edge", new Map(), tagSet(edge.dataClasses), diff.addedDataClasses, diff.removedDataClasses);
  }

  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  diff.addedNodes.sort(byId);
  diff.removedNodes.sort(byId);
  diff.changedNodes.sort(byId);
  diff.addedEdges.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  diff.removedEdges.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  diff.changedEdges.sort(byId);

  diff.isEmpty =
    !diff.addedNodes.length && !diff.removedNodes.length && !diff.changedNodes.length &&
    !diff.addedEdges.length && !diff.removedEdges.length && !diff.changedEdges.length &&
    !diff.addedDataClasses.length && !diff.removedDataClasses.length;
  return diff;
}
