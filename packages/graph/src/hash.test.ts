import { describe, expect, it } from "vitest";
import { canonicalJson, computeGraphHash, stableId } from "./hash";
import type { DependencyGraph } from "./schema";

const base = (): DependencyGraph => ({
  meta: { repo: "r", scanned_at: "2026-01-01T00:00:00Z", language_breakdown: { typescript: 1 }, total_files: 1 },
  nodes: [{ id: "a", name: "a", type: "service", language: "typescript", port: null, endpoints: [], path: "a" }],
  edges: [],
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined, b: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"b":[{"y":2,"z":1}],"d":2},"b":1}'
    );
  });
});

describe("computeGraphHash", () => {
  it("ignores scanned_at and any existing hash", () => {
    const a = base();
    const b = base();
    b.meta.scanned_at = "2030-05-05T00:00:00Z";
    b.meta.graphHash = "stale";
    expect(computeGraphHash(a)).toBe(computeGraphHash(b));
  });

  it("changes when content changes", () => {
    const a = base();
    const b = base();
    b.nodes[0]!.port = 3000;
    expect(computeGraphHash(a)).not.toBe(computeGraphHash(b));
  });

  it("does not depend on key order", () => {
    const a = base();
    const b = JSON.parse(JSON.stringify(a)) as DependencyGraph;
    b.nodes[0] = Object.fromEntries(Object.entries(b.nodes[0]!).reverse()) as never;
    expect(computeGraphHash(a)).toBe(computeGraphHash(b));
  });
});

describe("stableId", () => {
  it("is deterministic and separates parts", () => {
    expect(stableId("e", "a", "b")).toBe(stableId("e", "a", "b"));
    expect(stableId("e", "ab", "c")).not.toBe(stableId("e", "a", "bc"));
  });
});
