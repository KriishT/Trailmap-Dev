import { describe, expect, it } from "vitest";
import { prepareGraphForWrite, type DependencyGraph } from "@trailmap/graph";
import { layoutScene } from "./layout";
import { sceneToSvg } from "./svg";

/** A synthetic 300-node system: 240 services in tiers, plus datastores, queues and vendors. */
function bigGraph(): DependencyGraph {
  const nodes: DependencyGraph["nodes"] = [];
  const edges: DependencyGraph["edges"] = [];
  for (let i = 0; i < 240; i++) nodes.push({ id: `service:s${i}`, name: `service-${i}`, type: "service", language: "typescript", port: null, endpoints: [], path: `services/s${i}` });
  for (let i = 0; i < 30; i++) nodes.push({ id: `db:d${i}`, name: `db-${i}`, type: "database", language: "unknown", port: null, endpoints: [], path: "", engine: "postgres" });
  for (let i = 0; i < 15; i++) nodes.push({ id: `queue:q${i}`, name: `queue-${i}`, type: "queue", language: "unknown", port: null, endpoints: [], path: "", engine: "kafka" });
  for (let i = 0; i < 15; i++) nodes.push({ id: `vendor:v${i}`, name: `vendor-${i}`, type: "saas", language: "unknown", port: null, endpoints: [], path: "", vendor: `v${i}` });
  for (let i = 1; i < 240; i++) edges.push({ id: `e_s${i}`, from: `service:s${i}`, to: `service:s${Math.floor(i / 3)}`, type: "http", confidence: "high" });
  for (let i = 0; i < 240; i += 2) edges.push({ id: `e_d${i}`, from: `service:s${i}`, to: `db:d${i % 30}`, type: "database", confidence: "medium" });
  for (let i = 0; i < 240; i += 8) edges.push({ id: `e_q${i}`, from: `service:s${i}`, to: `queue:q${i % 15}`, type: "queue", confidence: "high" });
  for (let i = 0; i < 240; i += 16) edges.push({ id: `e_v${i}`, from: `service:s${i}`, to: `vendor:v${i % 15}`, type: "http", confidence: "high" });
  return prepareGraphForWrite({ meta: { repo: "big/system", scanned_at: "2026-01-01T00:00:00.000Z", language_breakdown: {}, total_files: 5000 }, nodes, edges });
}

describe("large systems", () => {
  it("lays out and draws a 300-node sheet in a few seconds", async () => {
    const g = bigGraph();
    expect(g.nodes).toHaveLength(300);
    const t0 = performance.now();
    const scene = await layoutScene(g, { kind: "system" });
    const t1 = performance.now();
    const svg = sceneToSvg(scene, { interactive: true });
    const t2 = performance.now();
    console.log(`300 nodes, ${g.edges.length} edges: layout ${Math.round(t1 - t0)} ms, draw ${Math.round(t2 - t1)} ms, svg ${Math.round(svg.length / 1024)} KiB`);
    expect(scene.nodes).toHaveLength(300);
    // about 1.2 s normally; V8 coverage instrumentation of the layout engine makes it ~15 s, so the bound is generous
    expect(t1 - t0).toBeLessThan(60_000);
    expect(t2 - t1).toBeLessThan(2_000);
    expect(svg.length).toBeLessThan(5 * 1024 * 1024);
  });
});
