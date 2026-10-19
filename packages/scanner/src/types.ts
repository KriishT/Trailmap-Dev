export type {
  Confidence,
  DependencyGraph,
  EdgeType,
  EvidenceKind,
  GraphEdge,
  GraphEvidence,
  GraphMeta,
  GraphNode,
  Language,
  NodeType,
} from "@trailmap/graph";

export interface ScanOptions {
  rootDir: string;
  /** Extra glob patterns to skip, on top of the built-in ones. */
  exclude?: string[];
  /** Also emit nodes for third-party libraries that are not vendors or datastores. */
  includeLibraries?: boolean;
  /** Real repo name (e.g. "org/repo") when scanning a temp clone whose directory name is meaningless. */
  repoName?: string;
  /** Treat test/spec files as evidence. Off by default: tests are not production behaviour. */
  includeTests?: boolean;
  /** Timestamp to record. Pass a fixed value for byte-identical output; defaults to now. */
  scannedAt?: string;
  /** Skip files larger than this (default 1 MB). */
  maxFileBytes?: number;
  maxDepth?: number;
}
