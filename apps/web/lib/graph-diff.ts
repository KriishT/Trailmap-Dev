import type { Confidence, DependencyGraph, EdgeType, GraphNode, NodeType } from "@trailmap/scanner";

export interface DiffNodeItem {
  key: string;
  id: string;
  name: string;
  type: NodeType;
  path?: string;
}

export interface DiffEdgeItem {
  key: string;
  from: string;
  to: string;
  type: EdgeType;
  confidence: Confidence;
}

export interface ChangedEdgeConfidenceItem {
  key: string;
  from: string;
  to: string;
  type: EdgeType;
  previousConfidence: Confidence;
  currentConfidence: Confidence;
}

export interface GraphSnapshotDiff {
  currentRepo: string;
  previousRepo: string;
  addedNodes: DiffNodeItem[];
  removedNodes: DiffNodeItem[];
  addedEdges: DiffEdgeItem[];
  removedEdges: DiffEdgeItem[];
  changedEdgeConfidence: ChangedEdgeConfidenceItem[];
  addedServices: DiffNodeItem[];
  addedDataStores: DiffNodeItem[];
  addedVendors: DiffNodeItem[];
  removedServices: DiffNodeItem[];
  removedDataStores: DiffNodeItem[];
  removedVendors: DiffNodeItem[];
  hasChanges: boolean;
}

export interface ComparableSnapshot {
  id: string;
  raw_json: DependencyGraph;
  scanned_at: string;
  commit_sha?: string | null;
}

export function diffGraphs(current: DependencyGraph, previous: DependencyGraph): GraphSnapshotDiff {
  const currentNodes = new Map(current.nodes.map((node) => [getNodeKey(node), toDiffNode(node)]));
  const previousNodes = new Map(previous.nodes.map((node) => [getNodeKey(node), toDiffNode(node)]));

  const addedNodes = [...currentNodes.entries()]
    .filter(([key]) => !previousNodes.has(key))
    .map(([, node]) => node)
    .sort(sortNodes);

  const removedNodes = [...previousNodes.entries()]
    .filter(([key]) => !currentNodes.has(key))
    .map(([, node]) => node)
    .sort(sortNodes);

  const currentEdges = new Map(current.edges.map((edge) => [getEdgeKey(current, edge), toDiffEdge(current, edge)]));
  const previousEdges = new Map(previous.edges.map((edge) => [getEdgeKey(previous, edge), toDiffEdge(previous, edge)]));

  const addedEdges = [...currentEdges.entries()]
    .filter(([key]) => !previousEdges.has(key))
    .map(([, edge]) => edge)
    .sort(sortEdges);

  const removedEdges = [...previousEdges.entries()]
    .filter(([key]) => !currentEdges.has(key))
    .map(([, edge]) => edge)
    .sort(sortEdges);

  const changedEdgeConfidence = [...currentEdges.entries()]
    .flatMap(([key, edge]) => {
      const previousEdge = previousEdges.get(key);
      if (!previousEdge || previousEdge.confidence === edge.confidence) return [];
      return [{
        key,
        from: edge.from,
        to: edge.to,
        type: edge.type,
        previousConfidence: previousEdge.confidence,
        currentConfidence: edge.confidence,
      }];
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));

  const addedServices = addedNodes.filter((node) => node.type === "service");
  const addedDataStores = addedNodes.filter((node) => node.type === "database");
  const addedVendors = addedNodes.filter((node) => node.type === "external" || node.type === "saas");
  const removedServices = removedNodes.filter((node) => node.type === "service");
  const removedDataStores = removedNodes.filter((node) => node.type === "database");
  const removedVendors = removedNodes.filter((node) => node.type === "external" || node.type === "saas");

  return {
    currentRepo: current.meta.repo,
    previousRepo: previous.meta.repo,
    addedNodes,
    removedNodes,
    addedEdges,
    removedEdges,
    changedEdgeConfidence,
    addedServices,
    addedDataStores,
    addedVendors,
    removedServices,
    removedDataStores,
    removedVendors,
    hasChanges:
      addedNodes.length > 0 ||
      removedNodes.length > 0 ||
      addedEdges.length > 0 ||
      removedEdges.length > 0 ||
      changedEdgeConfidence.length > 0,
  };
}

export function hasStructuralChanges(current: DependencyGraph, previous: DependencyGraph): boolean {
  return diffGraphs(current, previous).hasChanges;
}

export function selectDiffBaseline(snapshots: ComparableSnapshot[]): ComparableSnapshot | undefined {
  if (snapshots.length < 2) return undefined;

  const [current, ...history] = snapshots;

  if (current.commit_sha) {
    const previousDifferentCommit = history.find(
      (snapshot) => snapshot.commit_sha && snapshot.commit_sha !== current.commit_sha
    );
    if (previousDifferentCommit) return previousDifferentCommit;
  }

  const previousDifferentGraph = history.find((snapshot) =>
    hasStructuralChanges(current.raw_json, snapshot.raw_json)
  );
  if (previousDifferentGraph) return previousDifferentGraph;

  return history[0];
}

function getNodeKey(node: GraphNode): string {
  return `${node.type}:${node.name.trim().toLowerCase()}`;
}

function getEdgeKey(
  graph: DependencyGraph,
  edge: DependencyGraph["edges"][number]
): string {
  const fromNode = graph.nodes.find((node) => node.id === edge.from);
  const toNode = graph.nodes.find((node) => node.id === edge.to);
  const fromKey = fromNode ? getNodeKey(fromNode) : `unknown:${edge.from}`;
  const toKey = toNode ? getNodeKey(toNode) : `unknown:${edge.to}`;
  return `${fromKey}->${toKey}:${edge.type}`;
}

function toDiffNode(node: GraphNode): DiffNodeItem {
  return {
    key: getNodeKey(node),
    id: node.id,
    name: node.name,
    type: node.type,
    path: node.path,
  };
}

function toDiffEdge(
  graph: DependencyGraph,
  edge: DependencyGraph["edges"][number]
): DiffEdgeItem {
  const fromNode = graph.nodes.find((node) => node.id === edge.from);
  const toNode = graph.nodes.find((node) => node.id === edge.to);

  return {
    key: getEdgeKey(graph, edge),
    from: fromNode?.name ?? edge.from,
    to: toNode?.name ?? edge.to,
    type: edge.type,
    confidence: edge.confidence,
  };
}

function sortNodes(a: DiffNodeItem, b: DiffNodeItem): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
}

function sortEdges(a: DiffEdgeItem, b: DiffEdgeItem): number {
  return a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type);
}
