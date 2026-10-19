import type { DependencyGraph, GraphNode } from "./schema.js";

export type Risk = "low" | "medium" | "high";

const CODE_NODES = new Set(["service", "library", "function"]);
const VENDOR_NODES = new Set(["saas", "external"]);
const DATA_NODES = new Set(["database", "storage", "queue"]);

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

/** Everything that depends on `nodeId`, directly or through other nodes. */
export function dependentsOf(graph: DependencyGraph, nodeId: string): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of graph.edges) {
      if (e.to === cur && !seen.has(e.from)) {
        seen.add(e.from);
        queue.push(e.from);
      }
    }
  }
  seen.delete(nodeId);
  return [...seen].map((id) => byId.get(id)).filter((n): n is GraphNode => !!n && n.id !== "internet").sort((a, b) => a.id.localeCompare(b.id));
}

export interface NodeRisk {
  inbound: number;
  outbound: number;
  blastRadius: number;
  lowConfidence: number;
  risk: Risk;
}

/** How much depends on a node and how much it depends on, as a rough review-priority signal. */
export function nodeRisk(graph: DependencyGraph, nodeId: string): NodeRisk {
  const inbound = graph.edges.filter((e) => e.to === nodeId);
  const outbound = graph.edges.filter((e) => e.from === nodeId);
  const blast = dependentsOf(graph, nodeId).length;
  const low = [...inbound, ...outbound].filter((e) => e.confidence === "low").length;
  const node = graph.nodes.find((n) => n.id === nodeId);
  const bonus = node && DATA_NODES.has(node.type) ? 3 : node?.public ? 2 : 0;
  const score = inbound.length * 1.2 + outbound.length + blast * 1.5 + low * 0.75 + bonus;
  return { inbound: inbound.length, outbound: outbound.length, blastRadius: blast, lowConfidence: low, risk: score >= 9 ? "high" : score >= 4 ? "medium" : "low" };
}

export interface TouchedNode {
  id: string;
  name: string;
  path: string;
  changedFiles: string[];
  owners: string[];
  blastRadius: number;
  risk: Risk;
}

export interface ChangeImpact {
  touched: TouchedNode[];
  unmatchedFiles: string[];
  suggestedReviewers: string[];
  affectedVendors: string[];
  affectedDataStores: string[];
  affectedDependents: string[];
  summary: string;
}

function matchFile(nodes: GraphNode[], file: string): GraphNode | null {
  let best: { node: GraphNode; len: number } | null = null;
  for (const node of nodes) {
    const p = normalizePath(node.path || "");
    if (!p) continue;
    // A root service (path ".") owns every file no deeper service claims.
    if (p === ".") { if (!best) best = { node, len: 0 }; continue; }
    if (file === p || file.startsWith(p + "/")) {
      if (!best || p.length > best.len) best = { node, len: p.length };
    }
  }
  return best?.node ?? null;
}

const riskRank = (r: Risk) => (r === "high" ? 3 : r === "medium" ? 2 : 1);

/** Which nodes does a set of changed files touch, who owns them, and what sits downstream or depends on them? */
export function analyzeChangedFiles(
  graph: DependencyGraph,
  changedFiles: string[],
  ownersOf: (path: string) => string[] = () => []
): ChangeImpact {
  const codeNodes = graph.nodes.filter((n) => CODE_NODES.has(n.type) && n.path);
  const byNode = new Map<string, TouchedNode>();
  const unmatched: string[] = [];
  const reviewers = new Set<string>();

  for (const raw of changedFiles) {
    const file = normalizePath(raw);
    const owners = ownersOf(file);
    owners.forEach((o) => reviewers.add(o));
    const node = matchFile(codeNodes, file);
    if (!node) { unmatched.push(file); continue; }
    const existing = byNode.get(node.id);
    if (existing) {
      existing.changedFiles.push(file);
      existing.owners = [...new Set([...existing.owners, ...owners])];
      continue;
    }
    const risk = nodeRisk(graph, node.id);
    byNode.set(node.id, {
      id: node.id, name: node.name, path: node.path, changedFiles: [file], owners: [...owners],
      blastRadius: risk.blastRadius, risk: risk.risk,
    });
  }

  const touched = [...byNode.values()].sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || b.blastRadius - a.blastRadius || a.name.localeCompare(b.name));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const vendors = new Set<string>();
  const stores = new Set<string>();
  const dependents = new Set<string>();
  for (const t of touched) {
    for (const e of graph.edges) {
      if (e.from === t.id) {
        const target = nodes.get(e.to);
        if (target && VENDOR_NODES.has(target.type)) vendors.add(target.name);
        if (target && DATA_NODES.has(target.type)) stores.add(target.name);
      }
    }
    for (const d of dependentsOf(graph, t.id)) if (CODE_NODES.has(d.type) && !touched.some((x) => x.id === d.id)) dependents.add(d.name);
  }

  const lead = touched[0];
  const summary = [
    lead ? `${lead.name} is the main touched service` : "No changed file maps to a known service",
    vendors.size + stores.size > 0 ? `${vendors.size + stores.size} vendor or datastore dependenc${vendors.size + stores.size === 1 ? "y" : "ies"} sit downstream` : "No vendor or datastore dependencies downstream",
    dependents.size > 0 ? `${dependents.size} dependent service${dependents.size === 1 ? "" : "s"} may feel this change` : "No dependent services",
    unmatched.length ? `${unmatched.length} changed file${unmatched.length === 1 ? "" : "s"} did not map to a service` : "All changed files mapped to a service",
  ].join(". ") + ".";

  return {
    touched, unmatchedFiles: unmatched.sort(), suggestedReviewers: [...reviewers].sort(),
    affectedVendors: [...vendors].sort(), affectedDataStores: [...stores].sort(),
    affectedDependents: [...dependents].sort(), summary,
  };
}
