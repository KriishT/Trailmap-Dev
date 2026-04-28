export type NodeType = "service" | "library" | "external" | "database" | "saas";
export type EdgeType = "http" | "import" | "queue" | "database";
export type Confidence = "high" | "medium" | "low";
export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "ruby"
  | "unknown";

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
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  confidence: Confidence;
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
