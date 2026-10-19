import { createHash } from "node:crypto";
import type { DependencyGraph } from "./schema.js";

/** JSON with object keys sorted at every level, so equal content always serialises equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Content hash of a graph. It covers nodes, edges and the stable parts of meta, and ignores
 * `scanned_at` and `graphHash` itself, so rescanning an unchanged commit yields the same hash.
 */
export function computeGraphHash(graph: DependencyGraph): string {
  const { scanned_at: _scannedAt, graphHash: _graphHash, ...meta } = graph.meta;
  void _scannedAt;
  void _graphHash;
  return createHash("sha256")
    .update(canonicalJson({ meta, nodes: graph.nodes, edges: graph.edges }))
    .digest("hex");
}

/** Short deterministic id from parts, e.g. for edges: edgeId(from, to, type). */
export function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 12);
  return `${prefix}_${digest}`;
}
