import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prepareGraphForWrite, type DependencyGraph } from "@trailmap/graph";
import { createTrailmapMcpServer } from "./index";
import { GraphClient } from "./graph-client";

const graph: DependencyGraph = prepareGraphForWrite({
  meta: { repo: "acme/shop", scanned_at: "2026-01-01T00:00:00.000Z", language_breakdown: { typescript: 4 }, total_files: 4 },
  nodes: [
    { id: "service:web", name: "web", type: "service", language: "typescript", port: 3000, endpoints: ["GET /"], path: "apps/web" },
    { id: "service:pay", name: "pay", type: "service", language: "typescript", port: null, endpoints: ["POST /charge"], path: "apps/pay" },
    { id: "db:postgres", name: "PostgreSQL", type: "database", language: "unknown", port: null, endpoints: [], path: "", engine: "postgres" },
    { id: "vendor:stripe", name: "Stripe", type: "saas", language: "unknown", port: null, endpoints: [], path: "", vendor: "stripe" },
    { id: "lib:util", name: "util", type: "library", language: "typescript", port: null, endpoints: [], path: "packages/util" },
  ],
  edges: [
    { id: "e1", from: "service:web", to: "service:pay", type: "http", confidence: "high" },
    { id: "e2", from: "service:pay", to: "db:postgres", type: "database", confidence: "high", dataClasses: [{ class: "PII", certainty: "evidenced", evidence: [{ kind: "schema", source: "apps/pay/schema.sql", detail: "x", line: 4 }] }] },
    { id: "e3", from: "service:pay", to: "vendor:stripe", type: "http", confidence: "high", dataClasses: [{ class: "PAN", certainty: "possible", evidence: [] }] },
  ],
});
const scopes = [{ id: "s1", name: "PCI CDE", nodeIds: ["service:pay", "db:postgres"] }];

async function connect(client: GraphClient) {
  const server = createTrailmapMcpServer(client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await mcp.callTool({ name, arguments: args });
    return (r.content as Array<{ text: string }>)[0]!.text;
  };
  return { mcp, call };
}

afterEach(() => vi.unstubAllGlobals());

describe("MCP server", () => {
  it("exposes the original tools and the three compliance tools", async () => {
    const { mcp } = await connect(GraphClient.fromGraph(graph, scopes));
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "check_change", "find_path", "get_all_services", "get_blast_radius", "get_compliance_scope",
      "get_data_flows", "get_dependencies", "get_graph_summary", "get_service_endpoints",
    ]);
  });

  it("answers the original graph questions", async () => {
    const { call } = await connect(GraphClient.fromGraph(graph, scopes));
    expect(JSON.parse(await call("get_all_services"))).toHaveLength(5);
    const deps = JSON.parse(await call("get_dependencies", { service_id: "service:pay" }));
    expect(deps.inbound[0].from_name).toBe("web");
    expect(deps.outbound.map((e: { to: string }) => e.to).sort()).toEqual(["db:postgres", "vendor:stripe"]);
    expect(JSON.parse(await call("get_service_endpoints", { service_id: "service:pay" }))).toEqual(["POST /charge"]);
    expect(await call("find_path", { from_service: "service:web", to_service: "db:postgres" })).toContain("Path found (3 hops)");
    expect(await call("find_path", { from_service: "db:postgres", to_service: "service:web" })).toBe("No path found between these services.");
    expect(await call("get_blast_radius", { service_id: "db:postgres" })).toContain("2 services affected");
    expect(await call("get_blast_radius", { service_id: "service:web" })).toContain("no known consumers");
    expect(JSON.parse(await call("get_graph_summary"))).toMatchObject({ repo: "acme/shop", service_count: 2, database_count: 1, library_count: 1 });
  });

  it("get_compliance_scope lists members, connected nodes and boundary crossings", async () => {
    const { call } = await connect(GraphClient.fromGraph(graph, scopes));
    const [pci] = JSON.parse(await call("get_compliance_scope"));
    expect(pci.name).toBe("PCI CDE");
    expect(pci.members.map((m: { id: string }) => m.id).sort()).toEqual(["db:postgres", "service:pay"]);
    expect(pci.connected_to.map((n: { name: string }) => n.name).sort()).toEqual(["Stripe", "web"]);
    expect(pci.boundary_crossings).toEqual([
      { direction: "in", inside: "pay", outside: "web", type: "http", confidence: "high" },
      { direction: "out", inside: "pay", outside: "Stripe", type: "http", confidence: "high" },
    ]);
  });

  it("get_compliance_scope says so when none are defined", async () => {
    const { call } = await connect(GraphClient.fromGraph(graph));
    expect(await call("get_compliance_scope")).toContain("No compliance scopes are defined");
  });

  it("get_data_flows traces a class, with certainty and where it is shown", async () => {
    const { call } = await connect(GraphClient.fromGraph(graph, scopes));
    expect(JSON.parse(await call("get_data_flows", { data_class: "PII" }))).toEqual([
      { from: "service:pay", from_name: "pay", to: "db:postgres", to_name: "PostgreSQL", type: "database", certainty: "evidenced", evidence: "apps/pay/schema.sql:4" },
    ]);
    expect(JSON.parse(await call("get_data_flows", { data_class: "PAN" }))[0]).toMatchObject({ certainty: "possible", evidence: null });
    expect(await call("get_data_flows", { data_class: "PHI" })).toBe("No connection carries PHI.");
  });

  it("get_data_flows rejects an unknown class", async () => {
    const { mcp } = await connect(GraphClient.fromGraph(graph));
    const r = await mcp.callTool({ name: "get_data_flows", arguments: { data_class: "SECRETS" } });
    expect(r.isError).toBe(true);
  });

  it("check_change maps files to services and reports the scopes they reach", async () => {
    const { call } = await connect(GraphClient.fromGraph(graph, scopes));
    const r = JSON.parse(await call("check_change", { files: ["apps/pay/src/charge.ts", "docs/readme.md"] }));
    expect(r.touched.map((t: { id: string }) => t.id)).toEqual(["service:pay"]);
    expect(r.unmatchedFiles).toEqual(["docs/readme.md"]);
    expect(r.affectedVendors).toEqual(["Stripe"]);
    expect(r.affectedDependents).toEqual(["web"]);
    expect(r.scopes_touched).toEqual(["PCI CDE"]);
  });
});

describe("cloud mode client", () => {
  it("reads the API response shape and sends the key as a bearer token", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ graph, scopes }), { status: 200 });
    });
    const client = await GraphClient.fromApi("https://app.example.test/", "tmk_k", "repo 1");
    expect(seen).toEqual({ url: "https://app.example.test/api/mcp/graph/repo%201", auth: "Bearer tmk_k" });
    expect(client.getAllServices()).toHaveLength(5);
    expect(client.getComplianceScopes()).toHaveLength(1);
  });

  it("explains failures with the server's message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Invalid or missing API key" }), { status: 401, statusText: "Unauthorized" }));
    await expect(GraphClient.fromApi("https://x", "bad", "r")).rejects.toThrow("Failed to fetch graph (401): Invalid or missing API key");
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 502, statusText: "Bad Gateway" }));
    await expect(GraphClient.fromApi("https://x", "k", "r")).rejects.toThrow("Failed to fetch graph (502): Bad Gateway");
  });
});
