export { scan } from "./scanner.js";
export { SCANNER_VERSION } from "./assemble.js";
export { VENDORS, ENGINES, getVendor, getEngine } from "./catalog.js";
export type { Vendor, Engine } from "./catalog.js";
export type {
  DependencyGraph,
  GraphNode,
  GraphEdge,
  GraphMeta,
  GraphEvidence,
  ScanOptions,
  NodeType,
  EdgeType,
  Confidence,
  EvidenceKind,
  Language,
} from "./types.js";
