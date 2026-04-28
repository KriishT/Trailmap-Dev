#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTrailmapMcpServer } from "./index.js";
import { GraphClient } from "./graph-client.js";
import { scan } from "@trailmap/scanner";
import * as path from "path";

const mode = process.env.TRAILMAP_MODE ?? "local";

async function main() {
  let client: GraphClient;

  if (mode === "cloud") {
    // Cloud mode: fetch from Trailmap API
    const apiUrl = process.env.TRAILMAP_API_URL ?? "https://app.trailmap.dev";
    const apiKey = process.env.TRAILMAP_API_KEY;
    const repoId = process.env.TRAILMAP_REPO_ID;

    if (!apiKey || !repoId) {
      console.error("TRAILMAP_API_KEY and TRAILMAP_REPO_ID are required in cloud mode");
      process.exit(1);
    }

    console.error("[trailmap-mcp] Fetching graph from cloud API...");
    client = await GraphClient.fromApi(apiUrl, apiKey, repoId);
  } else {
    // Local mode: scan the directory
    const targetDir = process.env.TRAILMAP_SCAN_DIR ?? process.cwd();
    const absDir = path.resolve(targetDir);

    console.error(`[trailmap-mcp] Scanning ${absDir}...`);
    const graph = await scan({ rootDir: absDir });
    console.error(
      `[trailmap-mcp] Found ${graph.nodes.length} services, ${graph.edges.length} edges`
    );

    client = GraphClient.fromGraph(graph);
  }

  const server = createTrailmapMcpServer(client);
  const transport = new StdioServerTransport();

  console.error("[trailmap-mcp] MCP server ready");
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[trailmap-mcp] Fatal:", err);
  process.exit(1);
});
