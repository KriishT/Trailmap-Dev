import type { Confidence, DependencyGraph, GraphNode } from "@trailmap/scanner";

export interface NodeImpactMetrics {
  inboundCount: number;
  outboundCount: number;
  blastRadiusCount: number;
  lowConfidenceCount: number;
  riskLevel: "low" | "medium" | "high";
}

export interface GraphInsights {
  serviceCount: number;
  databaseCount: number;
  externalCount: number;
  saasCount: number;
  inferredEdgeCount: number;
  highConfidenceEdgeCount: number;
  topConnectedServices: Array<{ id: string; name: string; total: number }>;
  riskiestServices: Array<{ id: string; name: string; riskLevel: "low" | "medium" | "high"; blastRadius: number }>;
  externalVendors: string[];
  dataStores: string[];
  summary: string;
}

export function getNodeImpactMetrics(graph: DependencyGraph, nodeId: string): NodeImpactMetrics {
  const inbound = graph.edges.filter((edge) => edge.to === nodeId);
  const outbound = graph.edges.filter((edge) => edge.from === nodeId);
  const blastRadius = getBlastRadius(graph, nodeId);
  const lowConfidenceCount = [...inbound, ...outbound].filter((edge) => edge.confidence === "low").length;

  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const riskScore =
    inbound.length * 1.2 +
    outbound.length +
    blastRadius.length * 1.5 +
    lowConfidenceCount * 0.75 +
    criticalNodeBonus(node);

  return {
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    blastRadiusCount: blastRadius.length,
    lowConfidenceCount,
    riskLevel: scoreToRiskLevel(riskScore),
  };
}

export function buildGraphInsights(graph: DependencyGraph): GraphInsights {
  const services = graph.nodes.filter((node) => node.type === "service");
  const databases = graph.nodes.filter((node) => node.type === "database");
  const externals = graph.nodes.filter((node) => node.type === "external");
  const saas = graph.nodes.filter((node) => node.type === "saas");

  const topConnectedServices = services
    .map((node) => {
      const metrics = getNodeImpactMetrics(graph, node.id);
      return {
        id: node.id,
        name: node.name,
        total: metrics.inboundCount + metrics.outboundCount,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  const riskiestServices = services
    .map((node) => {
      const metrics = getNodeImpactMetrics(graph, node.id);
      return {
        id: node.id,
        name: node.name,
        riskLevel: metrics.riskLevel,
        blastRadius: metrics.blastRadiusCount,
        score: riskLevelRank(metrics.riskLevel) * 100 + metrics.blastRadiusCount,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score: _score, ...rest }) => rest);

  const inferredEdgeCount = graph.edges.filter((edge) => edge.confidence !== "high").length;
  const highConfidenceEdgeCount = graph.edges.length - inferredEdgeCount;

  return {
    serviceCount: services.length,
    databaseCount: databases.length,
    externalCount: externals.length,
    saasCount: saas.length,
    inferredEdgeCount,
    highConfidenceEdgeCount,
    topConnectedServices,
    riskiestServices,
    externalVendors: [...new Set([...saas, ...externals].map((node) => node.name))].sort(),
    dataStores: [...new Set(databases.map((node) => node.name))].sort(),
    summary: buildSummary(graph, {
      services,
      databases,
      externals,
      saas,
      topConnectedServices,
      inferredEdgeCount,
    }),
  };
}

export function formatConfidenceLabel(confidence: Confidence): string {
  if (confidence === "high") return "Explicit";
  if (confidence === "medium") return "Inferred";
  return "Weak signal";
}

function getBlastRadius(graph: DependencyGraph, nodeId: string): GraphNode[] {
  const affected = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const dependents = graph.edges
      .filter((edge) => edge.to === current)
      .map((edge) => edge.from);

    for (const dependent of dependents) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return graph.nodes.filter((node) => affected.has(node.id));
}

function criticalNodeBonus(node: GraphNode | undefined): number {
  if (!node) return 0;

  const name = node.name.toLowerCase();
  const framework = node.framework?.toLowerCase() ?? "";

  if (node.type === "database") return 3;
  if (name.includes("auth") || name.includes("payment") || name.includes("checkout")) return 3;
  if (framework === "nextjs") return 1.5;
  return 0;
}

function scoreToRiskLevel(score: number): "low" | "medium" | "high" {
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function riskLevelRank(level: "low" | "medium" | "high"): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function buildSummary(
  graph: DependencyGraph,
  data: {
    services: GraphNode[];
    databases: GraphNode[];
    externals: GraphNode[];
    saas: GraphNode[];
    topConnectedServices: Array<{ id: string; name: string; total: number }>;
    inferredEdgeCount: number;
  }
): string {
  const repo = graph.meta.repo;
  const primaryService = data.topConnectedServices[0]?.name;
  const totalVendors = new Set([...data.saas, ...data.externals].map((node) => node.name)).size;
  const confidenceNote =
    data.inferredEdgeCount > 0
      ? `${data.inferredEdgeCount} relationships are inferred and should be reviewed.`
      : "Most relationships are backed by high-confidence signals.";

  return `${repo} currently maps ${data.services.length} services, ${data.databases.length} data stores, and ${totalVendors} external dependencies. ${primaryService ? `${primaryService} appears to be the most connected service.` : "No dominant service has emerged yet."} ${confidenceNote}`;
}
