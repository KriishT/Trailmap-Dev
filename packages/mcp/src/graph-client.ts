import type { DependencyGraph, GraphNode, GraphEdge } from "@trailmap/scanner";

export class GraphClient {
  private graph: DependencyGraph;

  constructor(graph: DependencyGraph) {
    this.graph = graph;
  }

  static async fromApi(baseUrl: string, apiKey: string, repoId: string): Promise<GraphClient> {
    const res = await fetch(`${baseUrl}/api/mcp/graph/${repoId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch graph: ${res.statusText}`);
    const graph = await res.json();
    return new GraphClient(graph);
  }

  static fromGraph(graph: DependencyGraph): GraphClient {
    return new GraphClient(graph);
  }

  getAllServices(): GraphNode[] {
    return this.graph.nodes;
  }

  getDependencies(serviceId: string): { inbound: GraphEdge[]; outbound: GraphEdge[] } {
    return {
      inbound: this.graph.edges.filter((e) => e.to === serviceId),
      outbound: this.graph.edges.filter((e) => e.from === serviceId),
    };
  }

  getServiceEndpoints(serviceId: string): string[] {
    return this.graph.nodes.find((n) => n.id === serviceId)?.endpoints ?? [];
  }

  findPath(fromId: string, toId: string): string[] {
    // BFS to find shortest dependency path
    const queue: string[][] = [[fromId]];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1]!;

      if (current === toId) return path;

      const neighbors = this.graph.edges
        .filter((e) => e.from === current)
        .map((e) => e.to);

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }

    return [];
  }

  getBlastRadius(serviceId: string): GraphNode[] {
    // Find all nodes that would be affected if this service goes down (reverse reachability)
    const affected = new Set<string>();
    const queue = [serviceId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = this.graph.edges
        .filter((e) => e.to === current)
        .map((e) => e.from);

      for (const dep of dependents) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }

    return this.graph.nodes.filter((n) => affected.has(n.id));
  }

  getMeta() {
    return this.graph.meta;
  }
}
