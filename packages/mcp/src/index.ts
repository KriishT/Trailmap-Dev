import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GraphClient } from "./graph-client.js";

export function createTrailmapMcpServer(client: GraphClient): McpServer {
  const server = new McpServer({
    name: "trailmap",
    version: "0.1.0",
  });

  server.tool(
    "get_all_services",
    "Returns all services in the architecture graph with their metadata (type, language, port, path)",
    {},
    async () => {
      const services = client.getAllServices();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(services, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_dependencies",
    "Returns all inbound and outbound dependencies for a given service",
    { service_id: z.string().describe("The service node ID") },
    async ({ service_id }) => {
      const deps = client.getDependencies(service_id);
      const services = client.getAllServices();
      const enriched = {
        inbound: deps.inbound.map((e) => ({
          ...e,
          from_name: services.find((s) => s.id === e.from)?.name,
        })),
        outbound: deps.outbound.map((e) => ({
          ...e,
          to_name: services.find((s) => s.id === e.to)?.name,
        })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }],
      };
    }
  );

  server.tool(
    "get_service_endpoints",
    "Returns all HTTP endpoints exposed by a given service",
    { service_id: z.string().describe("The service node ID") },
    async ({ service_id }) => {
      const endpoints = client.getServiceEndpoints(service_id);
      return {
        content: [{ type: "text", text: JSON.stringify(endpoints, null, 2) }],
      };
    }
  );

  server.tool(
    "find_path",
    "Finds the dependency path between two services (BFS shortest path)",
    {
      from_service: z.string().describe("Source service node ID"),
      to_service: z.string().describe("Target service node ID"),
    },
    async ({ from_service, to_service }) => {
      const path = client.findPath(from_service, to_service);
      const services = client.getAllServices();
      const named = path.map((id) => ({
        id,
        name: services.find((s) => s.id === id)?.name ?? id,
      }));
      return {
        content: [
          {
            type: "text",
            text: path.length
              ? `Path found (${path.length} hops):\n${JSON.stringify(named, null, 2)}`
              : "No path found between these services.",
          },
        ],
      };
    }
  );

  server.tool(
    "get_blast_radius",
    "Returns all services that would be affected if the given service goes down",
    { service_id: z.string().describe("The service node ID to analyze") },
    async ({ service_id }) => {
      const affected = client.getBlastRadius(service_id);
      return {
        content: [
          {
            type: "text",
            text:
              affected.length === 0
                ? "No upstream dependents found — this service has no known consumers."
                : `${affected.length} services affected:\n${JSON.stringify(affected, null, 2)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_graph_summary",
    "Returns a summary of the architecture graph (service count, languages, scanned_at)",
    {},
    async () => {
      const meta = client.getMeta();
      const services = client.getAllServices();
      const summary = {
        ...meta,
        service_count: services.filter((s) => s.type === "service").length,
        database_count: services.filter((s) => s.type === "database").length,
        library_count: services.filter((s) => s.type === "library").length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  return server;
}

export { GraphClient };
export type { DependencyGraph } from "@trailmap/scanner";
