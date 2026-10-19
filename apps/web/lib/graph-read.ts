import { parseStoredGraph, type DependencyGraph } from "@trailmap/graph";

/**
 * Validate a graph loaded from the database. Returns null (and logs) instead of throwing,
 * so one unreadable snapshot degrades a page rather than crashing it.
 */
export function readSnapshotGraph(raw: unknown): DependencyGraph | null {
  try {
    return parseStoredGraph(raw);
  } catch (err) {
    console.error("[trailmap] unreadable graph snapshot:", err instanceof Error ? err.message : err);
    return null;
  }
}
