import { diffGraphs, edgeKey, evaluateDrift, parsePolicy, type DependencyGraph, type Scope } from "@trailmap/graph";
import { VENDORS } from "@trailmap/scanner";
import demoJson from "./demo-data.json";
import type { DemoData } from "./build";
import { summarizeChange } from "../workspace/load";
import { revisionLabel, type DriftView, type RevisionInfo, type WorkspaceData } from "../workspace/types";

const demo = demoJson as unknown as DemoData;

export const DEMO_REPO_ID = "demo";

/**
 * The public sample workspace: six revisions of a small online shop, one pull request that
 * adds an analytics vendor, and a PCI scope. Nothing here is saved anywhere and no sign-in is needed.
 */
export function demoWorkspace(rev?: string | null): WorkspaceData {
  const graphs = demo.revisions.map((r) => r.graph);
  const revisions: RevisionInfo[] = demo.revisions.map((r, i) => ({
    id: String(i),
    label: revisionLabel(i),
    scannedAt: r.date,
    commitSha: r.commit,
    graphHash: r.graph.meta.graphHash ?? null,
    nodeCount: r.graph.nodes.length,
    edgeCount: r.graph.edges.length,
    summary: summarizeChange(i > 0 ? graphs[i - 1]! : null, r.graph),
  }));
  const parsed = rev === undefined || rev === null || rev === "" ? NaN : Number(rev);
  const index = Number.isInteger(parsed) && parsed >= 0 && parsed < graphs.length ? parsed : graphs.length - 1;
  const graph: DependencyGraph = graphs[index]!;
  const previous = index > 0 ? graphs[index - 1]! : null;
  const diff = previous ? diffGraphs(previous, graph) : null;

  const scope: Scope = { id: "demo-scope", name: demo.scope.name, nodeIds: demo.scope.nodeIds };
  const { policy } = parsePolicy(demo.policy);
  const latest = graphs[graphs.length - 1]!;
  const result = evaluateDrift({ base: latest, head: demo.pullRequest.graph, scopes: [scope], policy });
  const drift: DriftView[] = [
    {
      id: "demo-pr",
      prNumber: demo.pullRequest.number,
      headSha: demo.pullRequest.headSha,
      conclusion: result.conclusion,
      status: "open",
      summary: result.summary,
      findings: result.findings.map((f) => ({ key: f.key, rule: f.rule, severity: f.severity, title: f.title, detail: f.detail, nodeIds: f.nodeIds, edgeIds: f.edgeIds })),
      acknowledgedBy: null,
      createdAt: demo.revisions.at(-1)!.date,
    },
  ];

  return {
    repo: { id: DEMO_REPO_ID, orgId: null, fullName: demo.repo.fullName, defaultBranch: demo.repo.defaultBranch },
    demo: true,
    revisions,
    selectedId: String(index),
    graph,
    effective: graph,
    highlightNodeIds: diff ? [...diff.addedNodes.map((n) => n.id), ...diff.changedNodes.map((c) => c.id)] : [],
    highlightEdgeIds: diff ? diff.addedEdges.map(edgeKey) : [],
    scopes: [scope],
    overrides: [],
    orphanedOverrides: 0,
    vendorMeta: demo.vendorMeta,
    catalog: VENDORS.map((v) => ({ id: v.id, name: v.name, category: v.category, website: v.website })),
    attestations: [],
    drift,
    exports: [],
    shares: [],
    policy: { frameworks: policy.frameworks, onDrift: policy.on_drift },
    permissions: { canAdmin: true },
    activeScan: null,
  };
}
