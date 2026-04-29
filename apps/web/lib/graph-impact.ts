import type { DependencyGraph, GraphNode } from "@trailmap/scanner";
import { diffGraphs } from "./graph-diff";
import { getNodeImpactMetrics } from "./graph-insights";

export interface ImpactServiceItem {
  id: string;
  name: string;
  changeType: "added" | "removed" | "rewired";
  blastRadius: number;
  riskLevel: "low" | "medium" | "high";
}

export interface GraphImpactAnalysis {
  touchedServices: ImpactServiceItem[];
  impactedServiceCount: number;
  touchedVendorCount: number;
  touchedDataStoreCount: number;
  totalRelationshipChanges: number;
  addedVendors: string[];
  addedDataStores: string[];
  removedVendors: string[];
  removedDataStores: string[];
  summary: string;
}

export interface ChangedFileImpact {
  path: string;
  serviceId: string | null;
  serviceName: string | null;
}

export interface PrTouchedServiceItem {
  id: string;
  name: string;
  path: string;
  changedFiles: string[];
  blastRadius: number;
  riskLevel: "low" | "medium" | "high";
}

export interface PrImpactAnalysis {
  changedFiles: ChangedFileImpact[];
  touchedServices: PrTouchedServiceItem[];
  unmatchedFiles: string[];
  affectedVendors: string[];
  affectedDataStores: string[];
  affectedDependents: string[];
  summary: string;
}

export function buildGraphImpactAnalysis(
  current: DependencyGraph,
  previous: DependencyGraph
): GraphImpactAnalysis {
  const diff = diffGraphs(current, previous);
  const currentServices = current.nodes.filter((node) => node.type === "service");
  const previousServices = previous.nodes.filter((node) => node.type === "service");
  const currentByName = new Map(currentServices.map((node) => [node.name.toLowerCase(), node]));
  const previousByName = new Map(previousServices.map((node) => [node.name.toLowerCase(), node]));

  const touched = new Map<string, ImpactServiceItem>();

  for (const service of diff.addedServices) {
    const node = currentByName.get(service.name.toLowerCase());
    const metrics = node ? getNodeImpactMetrics(current, node.id) : null;
    touched.set(service.name.toLowerCase(), {
      id: node?.id ?? service.id,
      name: service.name,
      changeType: "added",
      blastRadius: metrics?.blastRadiusCount ?? 0,
      riskLevel: metrics?.riskLevel ?? "low",
    });
  }

  for (const service of diff.removedServices) {
    const node = previousByName.get(service.name.toLowerCase());
    const metrics = node ? getNodeImpactMetrics(previous, node.id) : null;
    touched.set(service.name.toLowerCase(), {
      id: node?.id ?? service.id,
      name: service.name,
      changeType: "removed",
      blastRadius: metrics?.blastRadiusCount ?? 0,
      riskLevel: metrics?.riskLevel ?? "low",
    });
  }

  const relationshipServices = [
    ...diff.addedEdges.map((edge) => edge.from),
    ...diff.addedEdges.map((edge) => edge.to),
    ...diff.removedEdges.map((edge) => edge.from),
    ...diff.removedEdges.map((edge) => edge.to),
    ...diff.changedEdgeConfidence.map((edge) => edge.from),
    ...diff.changedEdgeConfidence.map((edge) => edge.to),
  ];

  for (const serviceName of relationshipServices) {
    const lower = serviceName.toLowerCase();
    if (touched.has(lower)) continue;

    const currentNode = currentByName.get(lower);
    const previousNode = previousByName.get(lower);
    const node = currentNode ?? previousNode;
    if (!node) continue;

    const graph = currentNode ? current : previous;
    const metrics = getNodeImpactMetrics(graph, node.id);
    touched.set(lower, {
      id: node.id,
      name: node.name,
      changeType: "rewired",
      blastRadius: metrics.blastRadiusCount,
      riskLevel: metrics.riskLevel,
    });
  }

  const touchedServices = [...touched.values()].sort((a, b) =>
    riskRank(b.riskLevel) - riskRank(a.riskLevel) ||
    b.blastRadius - a.blastRadius ||
    a.name.localeCompare(b.name)
  );

  const addedVendors = diff.addedVendors.map((node) => node.name).sort();
  const removedVendors = diff.removedVendors.map((node) => node.name).sort();
  const addedDataStores = diff.addedDataStores.map((node) => node.name).sort();
  const removedDataStores = diff.removedDataStores.map((node) => node.name).sort();
  const relationshipChanges =
    diff.addedEdges.length + diff.removedEdges.length + diff.changedEdgeConfidence.length;

  return {
    touchedServices,
    impactedServiceCount: touchedServices.length,
    touchedVendorCount: new Set([...addedVendors, ...removedVendors]).size,
    touchedDataStoreCount: new Set([...addedDataStores, ...removedDataStores]).size,
    totalRelationshipChanges: relationshipChanges,
    addedVendors,
    addedDataStores,
    removedVendors,
    removedDataStores,
    summary: buildImpactSummary(touchedServices, addedVendors, addedDataStores, relationshipChanges),
  };
}

function buildImpactSummary(
  touchedServices: ImpactServiceItem[],
  addedVendors: string[],
  addedDataStores: string[],
  relationshipChanges: number
): string {
  const lead = touchedServices[0];
  const leadText = lead
    ? `${lead.name} carries the biggest likely blast radius`
    : "No service-level impact surfaced yet";
  const depText =
    addedVendors.length + addedDataStores.length > 0
      ? `${addedVendors.length + addedDataStores.length} new dependency signal${addedVendors.length + addedDataStores.length === 1 ? "" : "s"} showed up`
      : "No new vendors or data stores were introduced";
  return `${leadText}. ${depText}. ${relationshipChanges} relationship change${relationshipChanges === 1 ? "" : "s"} detected.`;
}

function riskRank(level: "low" | "medium" | "high"): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

export function buildPrImpactAnalysis(
  graph: DependencyGraph,
  changedFilePaths: string[]
): PrImpactAnalysis {
  const serviceNodes = graph.nodes.filter((node) => node.type === "service");
  const changedFiles = changedFilePaths.map((filePath) => {
    const matchedService = matchFileToService(serviceNodes, filePath);
    return {
      path: normalizePath(filePath),
      serviceId: matchedService?.id ?? null,
      serviceName: matchedService?.name ?? null,
    };
  });

  const byService = new Map<string, PrTouchedServiceItem>();
  for (const item of changedFiles) {
    if (!item.serviceId) continue;
    const service = serviceNodes.find((node) => node.id === item.serviceId);
    if (!service) continue;
    const metrics = getNodeImpactMetrics(graph, service.id);
    const existing = byService.get(service.id);
    if (existing) {
      existing.changedFiles.push(item.path);
      continue;
    }

    byService.set(service.id, {
      id: service.id,
      name: service.name,
      path: service.path,
      changedFiles: [item.path],
      blastRadius: metrics.blastRadiusCount,
      riskLevel: metrics.riskLevel,
    });
  }

  const touchedServices = [...byService.values()].sort((a, b) =>
    riskRank(b.riskLevel) - riskRank(a.riskLevel) ||
    b.blastRadius - a.blastRadius ||
    a.name.localeCompare(b.name)
  );

  const affectedVendors = new Set<string>();
  const affectedDataStores = new Set<string>();
  const affectedDependents = new Set<string>();

  for (const service of touchedServices) {
    for (const edge of graph.edges) {
      if (edge.from === service.id) {
        const target = graph.nodes.find((node) => node.id === edge.to);
        if (!target) continue;
        if (target.type === "external" || target.type === "saas") affectedVendors.add(target.name);
        if (target.type === "database") affectedDataStores.add(target.name);
      }

      if (edge.to === service.id) {
        const dependent = graph.nodes.find((node) => node.id === edge.from);
        if (dependent?.type === "service") affectedDependents.add(dependent.name);
      }
    }
  }

  const unmatchedFiles = changedFiles.filter((item) => !item.serviceId).map((item) => item.path);

  return {
    changedFiles,
    touchedServices,
    unmatchedFiles,
    affectedVendors: [...affectedVendors].sort(),
    affectedDataStores: [...affectedDataStores].sort(),
    affectedDependents: [...affectedDependents].sort(),
    summary: buildPrSummary(touchedServices, affectedVendors.size, affectedDataStores.size, affectedDependents.size, unmatchedFiles.length),
  };
}

function matchFileToService(serviceNodes: GraphNode[], filePath: string): GraphNode | null {
  const normalizedFile = normalizePath(filePath);
  const rankedMatches = serviceNodes
    .map((node) => {
      const servicePath = normalizePath(node.path || "");
      if (!servicePath || servicePath === ".") return { node, score: 0, matched: false };
      if (normalizedFile === servicePath || normalizedFile.startsWith(`${servicePath}/`)) {
        return { node, score: servicePath.length, matched: true };
      }
      return { node, score: 0, matched: false };
    })
    .filter((item) => item.matched)
    .sort((a, b) => b.score - a.score);

  return rankedMatches[0]?.node ?? null;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function buildPrSummary(
  touchedServices: PrTouchedServiceItem[],
  vendorCount: number,
  dataStoreCount: number,
  dependentCount: number,
  unmatchedFileCount: number
): string {
  const lead = touchedServices[0];
  const leadText = lead
    ? `${lead.name} is the main touched service`
    : "No service match yet";
  const dependencyText =
    vendorCount + dataStoreCount > 0
      ? `${vendorCount + dataStoreCount} dependency surface${vendorCount + dataStoreCount === 1 ? "" : "s"} sit downstream`
      : "No vendor or data-store edges surfaced downstream";
  const dependentText =
    dependentCount > 0
      ? `${dependentCount} dependent service${dependentCount === 1 ? "" : "s"} may feel this change`
      : "No dependent services surfaced";
  const unmatchedText =
    unmatchedFileCount > 0
      ? `${unmatchedFileCount} changed file${unmatchedFileCount === 1 ? "" : "s"} did not map cleanly`
      : "All changed files mapped to known services";

  return `${leadText}. ${dependencyText}. ${dependentText}. ${unmatchedText}.`;
}
