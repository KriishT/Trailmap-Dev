export type NodeType = "service" | "library" | "external" | "database" | "saas";
export type EdgeType = "http" | "import" | "queue" | "database";
export type Confidence = "high" | "medium" | "low";
export type EvidenceKind =
  | "manifest"
  | "framework"
  | "port"
  | "openapi"
  | "compose"
  | "kubernetes"
  | "import"
  | "http-call"
  | "env"
  | "package-classification";
export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "ruby"
  | "unknown";

export interface GraphEvidence {
  kind: EvidenceKind;
  source: string;
  detail: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  language: Language;
  port: number | null;
  endpoints: string[];
  path: string;
  techStack?: string[];   // e.g. ["nextjs", "prisma", "tailwind"]
  framework?: string;     // e.g. "nextjs", "express", "fastapi"
  evidence?: GraphEvidence[];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  confidence: Confidence;
  evidence?: GraphEvidence[];
}

export interface GraphMeta {
  repo: string;
  scanned_at: string;
  language_breakdown: Record<string, number>;
  total_files: number;
}

export interface DependencyGraph {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ScanOptions {
  rootDir: string;
  exclude?: string[];
  maxDepth?: number;
  includeLibraries?: boolean;
}
