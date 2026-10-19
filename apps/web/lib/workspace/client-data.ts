import { buildVendorInventory, type VendorRow } from "@trailmap/graph";
import { listFrameworks } from "@trailmap/frameworks";
import { buildInspectorIndex, type InspectorIndex } from "./inspect";
import type { WorkspaceData } from "./types";

/** What the browser needs. The full graph stays on the server; the inspector index is the readable part of it. */
export interface ClientWorkspace extends Omit<WorkspaceData, "graph" | "effective" | "catalog"> {
  graphHash: string | null;
  scannedAt: string;
  scannerVersion: string | null;
  index: InspectorIndex;
  vendors: VendorRow[];
  frameworks: Array<{ id: string; name: string; version: string }>;
  hasNetworkSheet: boolean;
  hasDataClasses: boolean;
}

export function toClientWorkspace(data: WorkspaceData): ClientWorkspace {
  const { graph, effective, catalog, ...rest } = data;
  return {
    ...rest,
    graphHash: graph.meta.graphHash ?? null,
    scannedAt: graph.meta.scanned_at,
    scannerVersion: graph.meta.scannerVersion ?? null,
    index: buildInspectorIndex(effective, data.scopes),
    vendors: buildVendorInventory(effective, catalog, data.vendorMeta),
    frameworks: listFrameworks(),
    hasNetworkSheet: effective.nodes.some((n) => n.iac || n.type === "network" || n.type === "loadbalancer"),
    hasDataClasses: effective.edges.some((e) => (e.dataClasses ?? []).length > 0) || effective.nodes.some((n) => (n.dataClasses ?? []).length > 0),
  };
}
