import { describe, expect, it } from "vitest";
import {
  GRAPH_SCHEMA_VERSION,
  GraphValidationError,
  parseStoredGraph,
  prepareGraphForWrite,
} from "./schema";

const node = (id: string) => ({
  id,
  name: id,
  type: "service" as const,
  language: "typescript" as const,
  port: null,
  endpoints: [],
  path: id,
});

const graph = () => ({
  meta: {
    repo: "org/repo",
    scanned_at: "2026-01-01T00:00:00.000Z",
    language_breakdown: { typescript: 2 },
    total_files: 4,
  },
  nodes: [node("a"), node("b")],
  edges: [{ from: "a", to: "b", type: "import" as const, confidence: "high" as const }],
});

describe("graph schema", () => {
  it("stamps the schema version on write", () => {
    expect(prepareGraphForWrite(graph()).meta.graphSchemaVersion).toBe(GRAPH_SCHEMA_VERSION);
  });

  it("reads legacy snapshots that have no version", () => {
    expect(parseStoredGraph(graph()).nodes).toHaveLength(2);
  });

  it("rejects edges that point at unknown nodes", () => {
    const g = graph();
    g.edges[0]!.to = "ghost";
    expect(() => prepareGraphForWrite(g)).toThrow(/unknown node "ghost"/);
  });

  it("rejects duplicate node ids", () => {
    const g = graph();
    g.nodes.push(node("a"));
    expect(() => parseStoredGraph(g)).toThrow(GraphValidationError);
  });

  it("rejects a graph written by a newer schema", () => {
    const g = graph();
    (g.meta as Record<string, unknown>).graphSchemaVersion = GRAPH_SCHEMA_VERSION + 1;
    expect(() => parseStoredGraph(g)).toThrow(/newer than this build/);
  });

  it("rejects malformed input with a readable message and the failing context", () => {
    try {
      parseStoredGraph({ nodes: "nope" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GraphValidationError);
      expect((err as GraphValidationError).context).toBe("read");
      expect((err as Error).message).toContain("meta");
    }
  });
});
