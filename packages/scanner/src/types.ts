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
  exclude?: string[];
  maxDepth?: number;
  includeLibraries?: boolean;
  /** Real repo name (e.g. "org/repo") when scanning a temp clone whose directory name is meaningless. */
  repoName?: string;
}
