import { z } from "zod";

/** Bump when the stored graph shape changes in a way readers must handle. */
export const GRAPH_SCHEMA_VERSION = 2;

export const nodeTypeSchema = z.enum([
  "service",
  "library",
  "external",
  "database",
  "saas",
  "queue",
  "storage",
  "function",
  "loadbalancer",
  "network",
]);
export const edgeTypeSchema = z.enum(["http", "import", "queue", "database", "storage", "network"]);
export const confidenceSchema = z.enum(["high", "medium", "low"]);
export const languageSchema = z.enum([
  "typescript",
  "javascript",
  "python",
  "go",
  "java",
  "ruby",
  "csharp",
  "unknown",
]);
export const evidenceKindSchema = z.enum([
  "manifest",
  "framework",
  "port",
  "openapi",
  "compose",
  "kubernetes",
  "import",
  "http-call",
  "env",
  "package-classification",
  "declared",
  "sdk-import",
  "call-site",
  "terraform",
  "cloudformation",
  "helm",
  "schema",
  "dependency",
  "iac",
  "manual",
]);

export const dataClassSchema = z.enum(["PII", "PAN", "PHI", "CREDENTIALS"]);

/** `source` is the repo-relative file the evidence comes from. */
export const graphEvidenceSchema = z.object({
  kind: evidenceKindSchema,
  source: z.string(),
  detail: z.string(),
  /** 1-based line of the cited code, when the evidence points at a specific line. */
  line: z.number().int().positive().optional(),
  /** Short excerpt of that line (at most 120 characters). */
  snippet: z.string().max(120).optional(),
});

/**
 * A data class carried by a node or edge. `evidenced` means a specific code location shows
 * it; `possible` means it is implied (for example by what a vendor typically processes).
 * `override` is set when a person confirmed or removed it.
 */
export const dataClassTagSchema = z.object({
  class: dataClassSchema,
  certainty: z.enum(["evidenced", "possible"]),
  evidence: z.array(graphEvidenceSchema),
});

export const exposureSchema = z.object({
  direction: z.enum(["ingress", "egress"]),
  cidr: z.string(),
  port: z.number().int().nullable(),
  protocol: z.string().optional(),
  source: z.string(),
  line: z.number().int().positive().optional(),
});

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: nodeTypeSchema,
  language: languageSchema,
  port: z.number().int().nullable(),
  endpoints: z.array(z.string()),
  path: z.string(),
  techStack: z.array(z.string()).optional(),
  framework: z.string().optional(),
  evidence: z.array(graphEvidenceSchema).optional(),
  /** Vendor catalog id for SaaS / third-party nodes. */
  vendor: z.string().optional(),
  /** Datastore or queue engine (postgres, redis, kafka, ...). */
  engine: z.string().optional(),
  dataClasses: z.array(dataClassTagSchema).optional(),
  /** True when the resource is reachable from the public internet. */
  public: z.boolean().optional(),
  exposure: z.array(exposureSchema).optional(),
  iac: z
    .object({ provider: z.string(), resourceType: z.string(), address: z.string() })
    .optional(),
});

export const graphEdgeSchema = z.object({
  /** Stable across scans: derived from (from, to, type). Absent on pre-v2 snapshots. */
  id: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  type: edgeTypeSchema,
  confidence: confidenceSchema,
  evidence: z.array(graphEvidenceSchema).optional(),
  dataClasses: z.array(dataClassTagSchema).optional(),
});

export const graphMetaSchema = z.object({
  repo: z.string(),
  scanned_at: z.string(),
  language_breakdown: z.record(z.number()),
  total_files: z.number().int().nonnegative(),
  /** Absent on snapshots written before versioning; readers treat that as version 1. */
  graphSchemaVersion: z.number().int().positive().optional(),
  scannerVersion: z.string().optional(),
  /** sha256 of the canonical graph content (see hash.ts). Excludes scanned_at. */
  graphHash: z.string().optional(),
});

export const dependencyGraphSchema = z
  .object({
    meta: graphMetaSchema,
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>();
    graph.nodes.forEach((node, i) => {
      if (ids.has(node.id)) {
        ctx.addIssue({ code: "custom", path: ["nodes", i, "id"], message: `duplicate node id "${node.id}"` });
      }
      ids.add(node.id);
    });
    graph.edges.forEach((edge, i) => {
      for (const end of ["from", "to"] as const) {
        if (!ids.has(edge[end])) {
          ctx.addIssue({
            code: "custom",
            path: ["edges", i, end],
            message: `edge references unknown node "${edge[end]}"`,
          });
        }
      }
    });
  });

export type NodeType = z.infer<typeof nodeTypeSchema>;
export type EdgeType = z.infer<typeof edgeTypeSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type Language = z.infer<typeof languageSchema>;
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export type DataClass = z.infer<typeof dataClassSchema>;
export type DataClassTag = z.infer<typeof dataClassTagSchema>;
export type Exposure = z.infer<typeof exposureSchema>;
export type GraphEvidence = z.infer<typeof graphEvidenceSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphMeta = z.infer<typeof graphMetaSchema>;
export type DependencyGraph = z.infer<typeof dependencyGraphSchema>;

export class GraphValidationError extends Error {
  constructor(
    readonly context: "write" | "read",
    readonly issues: string[]
  ) {
    super(`Invalid graph on ${context}: ${issues.slice(0, 5).join("; ")}`);
    this.name = "GraphValidationError";
  }
}

function validate(input: unknown, context: "write" | "read"): DependencyGraph {
  const result = dependencyGraphSchema.safeParse(input);
  if (!result.success) {
    throw new GraphValidationError(
      context,
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    );
  }
  const version = result.data.meta.graphSchemaVersion ?? 1;
  if (version > GRAPH_SCHEMA_VERSION) {
    throw new GraphValidationError(context, [
      `graphSchemaVersion ${version} is newer than this build supports (${GRAPH_SCHEMA_VERSION})`,
    ]);
  }
  return result.data;
}

/** Validate a graph about to be persisted and stamp the current schema version. */
export function prepareGraphForWrite(input: unknown): DependencyGraph {
  const graph = validate(input, "write");
  return { ...graph, meta: { ...graph.meta, graphSchemaVersion: GRAPH_SCHEMA_VERSION } };
}

/** Validate a graph loaded from storage (including legacy unversioned snapshots). */
export function parseStoredGraph(input: unknown): DependencyGraph {
  return validate(input, "read");
}
