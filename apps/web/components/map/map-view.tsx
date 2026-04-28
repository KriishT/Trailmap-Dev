"use client";

import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  Node, Edge, BackgroundVariant, Panel,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { useCallback, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { DependencyGraph, GraphNode } from "@trailmap/scanner";
import { NodeDetailPanel } from "./node-detail-panel";

const NODE_CONFIGS: Record<string, { color: string; shape: "rect" | "rounded" | "pill"; label: string }> = {
  service:  { color: "#E8754A", shape: "rounded", label: "Service" },
  database: { color: "#7C6FE0", shape: "rect",    label: "Database" },
  saas:     { color: "#2D9CDB", shape: "pill",    label: "SaaS" },
  external: { color: "#D4A017", shape: "pill",    label: "External" },
  library:  { color: "#27AE60", shape: "rounded", label: "Library" },
};

const EDGE_COLORS: Record<string, string> = {
  http:     "#E8754A",
  import:   "rgba(26,15,8,0.2)",
  queue:    "#D4A017",
  database: "#7C6FE0",
};

const NODE_WIDTH = 168;
const NODE_HEIGHT = 44;

// Non-service nodes are slightly smaller
const SECONDARY_WIDTH = 140;
const SECONDARY_HEIGHT = 36;

function layoutGraph(graph: DependencyGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });

  for (const node of graph.nodes) {
    const isService = node.type === "service";
    g.setNode(node.id, {
      width: isService ? NODE_WIDTH : SECONDARY_WIDTH,
      height: isService ? NODE_HEIGHT : SECONDARY_HEIGHT,
    });
  }
  for (const edge of graph.edges) g.setEdge(edge.from, edge.to);
  dagre.layout(g);

  const nodes: Node[] = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return null;
    const cfg = NODE_CONFIGS[n.type] ?? NODE_CONFIGS.service;
    const isService = n.type === "service";
    const w = isService ? NODE_WIDTH : SECONDARY_WIDTH;
    const h = isService ? NODE_HEIGHT : SECONDARY_HEIGHT;

    const borderRadius =
      cfg.shape === "pill" ? "999px" :
      cfg.shape === "rect" ? "6px" : "10px";

    // Framework badge in label
    const displayName = n.framework
      ? `${n.name}\n${n.framework}`
      : n.name;

    return {
      id: n.id,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
      data: { label: buildNodeLabel(n), node: n },
      type: "default",
      style: {
        background: isService ? "#FFFFFF" : `${cfg.color}12`,
        border: `${isService ? "1.5px" : "1px"} solid ${cfg.color}${isService ? "" : "55"}`,
        borderRadius,
        color: "#1A0F08",
        fontSize: isService ? "12px" : "11px",
        fontFamily: "var(--font-body), system-ui, sans-serif",
        fontWeight: isService ? 500 : 400,
        width: w,
        height: h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 12px",
        boxShadow: isService ? `0 2px 8px rgba(26,15,8,0.08)` : "none",
      },
    };
  }).filter(Boolean) as Node[];

  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.from,
    target: e.to,
    label: e.type === "database" ? "db" : e.type === "http" ? undefined : e.type,
    animated: e.type === "http",
    style: {
      stroke: EDGE_COLORS[e.type] ?? "rgba(26,15,8,0.2)",
      strokeWidth: e.confidence === "high" ? 1.5 : 1,
      strokeDasharray: e.confidence === "low" ? "4,4" : undefined,
    },
    labelStyle: { fill: "rgba(26,15,8,0.35)", fontSize: 9, fontFamily: "var(--font-body)" },
    labelBgStyle: { fill: "#FAF8F5", fillOpacity: 0.9 },
    labelBgPadding: [3, 4] as [number, number],
  }));

  return { nodes, edges };
}

function buildNodeLabel(n: GraphNode): React.ReactNode {
  const cfg = NODE_CONFIGS[n.type] ?? NODE_CONFIGS.service;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.3, gap: "1px" }}>
      <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "140px" }}>{n.name}</span>
      {(n.framework || n.type !== "service") && (
        <span style={{
          fontSize: "9px", color: cfg.color, fontWeight: 400,
          textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.8,
        }}>
          {n.framework ?? n.type}
        </span>
      )}
    </div>
  );
}

export function MapView({ graph }: { graph: DependencyGraph }) {
  const { nodes: initialNodes, edges: initialEdges } = layoutGraph(graph);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showLowConfidence, setShowLowConfidence] = useState(false);

  const visibleEdges = showLowConfidence
    ? edges
    : edges.filter((_, i) => graph.edges[i]?.confidence !== "low");

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.data.node as GraphNode);
  }, []);

  const serviceCount = graph.nodes.filter(n => n.type === "service").length;
  const dbCount = graph.nodes.filter(n => n.type === "database").length;
  const saasCount = graph.nodes.filter(n => n.type === "saas").length;
  const externalCount = graph.nodes.filter(n => n.type === "external").length;

  // Only show legend entries that have nodes
  const legendEntries = Object.entries(NODE_CONFIGS).filter(([type]) => {
    if (type === "service") return serviceCount > 0;
    if (type === "database") return dbCount > 0;
    if (type === "saas") return saasCount > 0;
    if (type === "external") return externalCount > 0;
    return false;
  });

  return (
    <div style={{ flex: 1, display: "flex", background: "#FAF8F5" }}>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          attributionPosition="bottom-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(26,15,8,0.08)" />
          <Controls style={{ background: "#fff", border: "1px solid rgba(26,15,8,0.1)", borderRadius: "10px", boxShadow: "0 2px 8px rgba(26,15,8,0.08)" }} />
          <MiniMap
            nodeColor={(n) => NODE_CONFIGS[(n.data?.node as GraphNode)?.type ?? "service"]?.color ?? "#E8754A"}
            style={{ background: "#fff", border: "1px solid rgba(26,15,8,0.1)", borderRadius: "10px" }}
          />

          <Panel position="top-left">
            <label style={{
              display: "flex", alignItems: "center", gap: "8px", cursor: "pointer",
              fontSize: "0.75rem", fontFamily: "var(--font-body)",
              color: "rgba(26,15,8,0.5)",
              background: "#fff", border: "1px solid rgba(26,15,8,0.09)",
              borderRadius: "8px", padding: "6px 12px",
              boxShadow: "0 1px 4px rgba(26,15,8,0.06)",
            }}>
              <input type="checkbox" checked={showLowConfidence}
                onChange={e => setShowLowConfidence(e.target.checked)} style={{ width: "12px", height: "12px" }} />
              Show inferred edges
            </label>
          </Panel>

          {legendEntries.length > 0 && (
            <Panel position="bottom-left">
              <div style={{
                background: "#fff", border: "1px solid rgba(26,15,8,0.09)",
                borderRadius: "10px", padding: "10px 14px",
                boxShadow: "0 1px 4px rgba(26,15,8,0.06)",
                display: "flex", flexDirection: "column", gap: "6px",
              }}>
                {legendEntries.map(([type, cfg]) => (
                  <div key={type} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: cfg.shape === "rect" ? "2px" : "50%", background: cfg.color, display: "block" }} />
                    <span style={{ fontSize: "11px", fontFamily: "var(--font-body)", color: "rgba(26,15,8,0.5)" }}>{cfg.label}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      <AnimatePresence>
        {selectedNode && (
          <NodeDetailPanel node={selectedNode} graph={graph} onClose={() => setSelectedNode(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
