import {
  analyzeChangedFiles, analyzeScope, dataFlows, dependentsOf,
  type ChangeImpact, type DataClass, type DependencyGraph, type GraphEdge, type GraphNode, type Scope, type ScopeAnalysis,
} from "@trailmap/graph";

export class GraphClient {
  constructor(
    private readonly graph: DependencyGraph,
    private readonly scopes: Scope[] = []
  ) {}

  /** Cloud mode: fetch the latest graph (with human decisions applied) and scopes using an API key. */
  static async fromApi(baseUrl: string, apiKey: string, repoId: string): Promise<GraphClient> {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/mcp/graph/${encodeURIComponent(repoId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const detail = await res.json().then((j: { error?: string }) => j.error).catch(() => undefined);
      throw new Error(`Failed to fetch graph (${res.status}): ${detail ?? res.statusText}`);
    }
    const body = (await res.json()) as { graph: DependencyGraph; scopes?: Scope[] };
    return new GraphClient(body.graph, body.scopes ?? []);
  }

  static fromGraph(graph: DependencyGraph, scopes: Scope[] = []): GraphClient {
    return new GraphClient(graph, scopes);
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

  /** Shortest dependency path (breadth first). */
  findPath(fromId: string, toId: string): string[] {
    const queue: string[][] = [[fromId]];
    const visited = new Set<string>([fromId]);
    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1]!;
      if (current === toId) return path;
      for (const e of this.graph.edges) {
        if (e.from === current && !visited.has(e.to)) {
          visited.add(e.to);
          queue.push([...path, e.to]);
        }
      }
    }
    return [];
  }

  /** Everything that would be affected if this node goes down (reverse reachability). */
  getBlastRadius(serviceId: string): GraphNode[] {
    return dependentsOf(this.graph, serviceId);
  }

  getMeta() {
    return this.graph.meta;
  }

  /** Compliance scopes with their members, connected-to set and boundary crossings. */
  getComplianceScopes(): ScopeAnalysis[] {
    return this.scopes.map((scope) => analyzeScope(this.graph, scope));
  }

  /** Connections that carry a data class, with the nodes' names resolved. */
  getDataFlows(dataClass: DataClass) {
    const names = new Map(this.graph.nodes.map((n) => [n.id, n.name]));
    return dataFlows(this.graph, dataClass).map((e) => {
      const tag = e.dataClasses!.find((t) => t.class === dataClass)!;
      const ev = tag.evidence.find((x) => x.line) ?? tag.evidence[0];
      return {
        from: e.from, from_name: names.get(e.from) ?? e.from, to: e.to, to_name: names.get(e.to) ?? e.to,
        type: e.type, certainty: tag.certainty, evidence: ev ? `${ev.source}${ev.line ? `:${ev.line}` : ""}` : null,
      };
    });
  }

  /** What a change to these files touches, and which compliance scopes it reaches. */
  checkChange(files: string[]): ChangeImpact & { scopes_touched: string[] } {
    const impact = analyzeChangedFiles(this.graph, files);
    const touched = new Set(impact.touched.map((t) => t.id));
    const scopes_touched = this.scopes.filter((s) => s.nodeIds.some((id) => touched.has(id))).map((s) => s.name);
    return { ...impact, scopes_touched };
  }
}
