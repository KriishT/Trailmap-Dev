import { DependencyGraph } from "@trailmap/scanner";

export function renderHtml(graph: DependencyGraph): string {
  const graphJson = JSON.stringify(graph, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trailmap — ${graph.meta.repo}</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f1117; color: #e1e4e8; }
    header { padding: 16px 24px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 18px; font-weight: 600; }
    header .meta { font-size: 12px; color: #8b949e; margin-left: auto; }
    #graph { width: 100%; height: calc(100vh - 57px); }
    .legend { position: fixed; bottom: 24px; left: 24px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; }
    .legend h3 { font-size: 11px; text-transform: uppercase; color: #8b949e; margin-bottom: 8px; letter-spacing: 0.5px; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 4px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .service { background: #58a6ff; }
    .database { background: #f78166; }
    .library { background: #3fb950; }
    .external { background: #d29922; }
  </style>
</head>
<body>
  <header>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2">
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>
    </svg>
    <h1>Trailmap — ${graph.meta.repo}</h1>
    <span class="meta">Scanned ${new Date(graph.meta.scanned_at).toLocaleString()} · ${graph.nodes.length} services · ${graph.edges.length} edges</span>
  </header>
  <div id="graph"></div>
  <div class="legend">
    <h3>Legend</h3>
    <div class="legend-item"><div class="dot service"></div> Service</div>
    <div class="legend-item"><div class="dot database"></div> Database</div>
    <div class="legend-item"><div class="dot library"></div> Library</div>
    <div class="legend-item"><div class="dot external"></div> External</div>
  </div>
  <script>
    const graph = ${graphJson};

    const COLOR_MAP = {
      service: '#58a6ff',
      database: '#f78166',
      library: '#3fb950',
      external: '#d29922',
    };

    const EDGE_COLOR_MAP = {
      http: '#58a6ff',
      import: '#8b949e',
      queue: '#d29922',
      database: '#f78166',
    };

    const nodes = new vis.DataSet(graph.nodes.map(n => ({
      id: n.id,
      label: n.name + (n.port ? '\\n:' + n.port : ''),
      color: { background: COLOR_MAP[n.type] || '#58a6ff', border: '#30363d' },
      font: { color: '#e1e4e8', size: 12 },
      shape: n.type === 'database' ? 'cylinder' : 'box',
      borderWidth: 2,
    })));

    const edges = new vis.DataSet(graph.edges.map((e, i) => ({
      id: i,
      from: e.from,
      to: e.to,
      label: e.type,
      color: { color: EDGE_COLOR_MAP[e.type] || '#8b949e' },
      font: { color: '#8b949e', size: 10, strokeWidth: 0 },
      arrows: 'to',
      dashes: e.confidence === 'low',
      width: e.confidence === 'high' ? 2 : 1,
    })));

    const container = document.getElementById('graph');
    new vis.Network(container, { nodes, edges }, {
      layout: { hierarchical: { enabled: false } },
      physics: { solver: 'forceAtlas2Based', stabilization: { iterations: 200 } },
      interaction: { hover: true, tooltipDelay: 200 },
    });
  </script>
</body>
</html>`;
}
