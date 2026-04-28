"use client";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  BackgroundVariant,
  Panel,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { useCallback, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { DependencyGraph, GraphEdge, GraphNode } from "@trailmap/scanner";
import { NodeDetailPanel } from "./node-detail-panel";

const NODE_CONFIGS: Record<string, { color: string; shape: "rect" | "rounded" | "pill"; label: string }> = {
  service: { color: "#E8754A", shape: "rounded", label: "Service" },
  database: { color: "#7C6FE0", shape: "rect", label: "Database" },
  saas: { color: "#2D9CDB", shape: "pill", label: "SaaS" },
  external: { color: "#D4A017", shape: "pill", label: "External" },
  library: { color: "#27AE60", shape: "rounded", label: "Library" },
};

const EDGE_COLORS: Record<string, string> = {
  http: "#E8754A",
  import: "rgba(26,15,8,0.2)",
  queue: "#D4A017",
  database: "#7C6FE0",
};

const NODE_WIDTH = 168;
const NODE_HEIGHT = 44;
const SECONDARY_WIDTH = 140;
const SECONDARY_HEIGHT = 36;

type FocusMode = "full" | "neighbors" | "upstream" | "downstream";

interface SelectedEdgeState {
  edge: GraphEdge;
  sourceName: string;
  targetName: string;
}

const focusModes: Array<{ id: FocusMode; label: string }> = [
  { id: "full", label: "Full" },
  { id: "neighbors", label: "Nearby" },
  { id: "upstream", label: "Upstream" },
  { id: "downstream", label: "Downstream" },
];

function layoutGraph(graph: DependencyGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 120, ranksep: 140, marginx: 24, marginy: 24 });

  for (const node of graph.nodes) {
    const isService = node.type === "service";
    g.setNode(node.id, {
      width: isService ? NODE_WIDTH : SECONDARY_WIDTH,
      height: isService ? NODE_HEIGHT : SECONDARY_HEIGHT,
    });
  }

  for (const edge of graph.edges) g.setEdge(edge.from, edge.to);
  dagre.layout(g);

  compactLayoutHorizontally(g);

  const nodes: Node[] = graph.nodes
    .map((node) => {
      const pos = g.node(node.id);
      if (!pos) return null;

      const cfg = NODE_CONFIGS[node.type] ?? NODE_CONFIGS.service;
      const isService = node.type === "service";
      const width = isService ? NODE_WIDTH : SECONDARY_WIDTH;
      const height = isService ? NODE_HEIGHT : SECONDARY_HEIGHT;
      const borderRadius =
        cfg.shape === "pill" ? "999px" :
        cfg.shape === "rect" ? "6px" : "10px";

      return {
        id: node.id,
        position: { x: pos.x - width / 2, y: pos.y - height / 2 },
        data: { label: buildNodeLabel(node), node },
        type: "default",
        style: {
          background: isService ? "#FFFFFF" : `${cfg.color}12`,
          border: `${isService ? "1.5px" : "1px"} solid ${cfg.color}${isService ? "" : "55"}`,
          borderRadius,
          color: "#1A0F08",
          fontSize: isService ? "12px" : "11px",
          fontFamily: "var(--font-body), system-ui, sans-serif",
          fontWeight: isService ? 500 : 400,
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 12px",
          boxShadow: isService ? "0 2px 8px rgba(26,15,8,0.08)" : "none",
        },
      };
    })
    .filter(Boolean) as Node[];

  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `e-${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.type === "database" ? "db" : edge.type === "http" ? undefined : edge.type,
    animated: edge.type === "http",
    style: {
      stroke: EDGE_COLORS[edge.type] ?? "rgba(26,15,8,0.2)",
      strokeWidth: edge.confidence === "high" ? 1.5 : 1,
      strokeDasharray: edge.confidence === "low" ? "4,4" : undefined,
    },
    labelStyle: { fill: "rgba(26,15,8,0.35)", fontSize: 9, fontFamily: "var(--font-body)" },
    labelBgStyle: { fill: "#FAF8F5", fillOpacity: 0.9 },
    labelBgPadding: [3, 4] as [number, number],
  }));

  return { nodes, edges };
}

function compactLayoutHorizontally(graph: dagre.graphlib.Graph) {
  const nodes = graph.nodes().map((id) => ({ id, pos: graph.node(id) })).filter((entry) => entry.pos);
  if (nodes.length === 0) return;

  const xs = nodes.map((entry) => entry.pos.x as number);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const width = maxX - minX;

  const targetWidth = 2600;
  if (width <= targetWidth) return;

  const scale = targetWidth / width;
  for (const { id, pos } of nodes) {
    graph.setNode(id, {
      ...pos,
      x: minX + ((pos.x as number) - minX) * scale,
    });
  }
}

function buildNodeLabel(node: GraphNode): React.ReactNode {
  const cfg = NODE_CONFIGS[node.type] ?? NODE_CONFIGS.service;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.3, gap: "1px" }}>
      <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "140px" }}>{node.name}</span>
      {(node.framework || node.type !== "service") && (
        <span style={{
          fontSize: "9px",
          color: cfg.color,
          fontWeight: 400,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          opacity: 0.8,
        }}>
          {node.framework ?? node.type}
        </span>
      )}
    </div>
  );
}

export function MapView({ graph }: { graph: DependencyGraph }) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdgeState | null>(null);
  const [showLowConfidence, setShowLowConfidence] = useState(false);
  const [focusMode, setFocusMode] = useState<FocusMode>("full");
  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => layoutGraph(graph), [graph]);

  const relation = selectedNode ? getFocusRelation(graph, selectedNode.id, focusMode) : null;
  const activeNodeIds = relation?.activeNodeIds ?? new Set<string>();
  const highlightedNodeIds = relation?.highlightedNodeIds ?? new Set<string>();
  const highlightedEdgeIndexes = relation?.highlightedEdgeIndexes ?? new Set<number>();

  const visibleNodes = useMemo(() => (
    baseNodes
      .filter((node) => {
        if (!selectedNode || focusMode === "full") return true;
        return activeNodeIds.has(node.id);
      })
      .map((node) => {
        const isSelected = selectedNode?.id === node.id;
        const isRelated = highlightedNodeIds.has(node.id);
        const shouldDim = !!selectedNode && focusMode === "full" && !isRelated && !isSelected;

        return {
          ...node,
          selected: isSelected,
          style: {
            ...node.style,
            opacity: shouldDim ? 0.28 : 1,
            boxShadow: isSelected
              ? "0 10px 24px rgba(232,117,74,0.18), 0 0 0 2px rgba(232,117,74,0.12)"
              : node.style?.boxShadow,
          },
        };
      })
  ), [activeNodeIds, baseNodes, focusMode, highlightedNodeIds, selectedNode]);

  const visibleEdges = useMemo(() => (
    baseEdges
      .map((edge, index) => ({ edge, index, graphEdge: graph.edges[index] }))
      .filter(({ edge, graphEdge, index }) => {
        if (!showLowConfidence && graphEdge?.confidence === "low") return false;
        if (!selectedNode || focusMode === "full") return true;
        return activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target) && highlightedEdgeIndexes.has(index);
      })
      .map(({ edge, index, graphEdge }) => {
        const isHighlighted = highlightedEdgeIndexes.has(index);
        const shouldDim = !!selectedNode && focusMode === "full" && !isHighlighted;
        const isSelected =
          !!selectedEdge &&
          selectedEdge.edge.from === graphEdge?.from &&
          selectedEdge.edge.to === graphEdge?.to &&
          selectedEdge.edge.type === graphEdge?.type;

        return {
          ...edge,
          animated: graphEdge?.type === "http" && (isHighlighted || !selectedNode),
          style: {
            ...edge.style,
            opacity: shouldDim ? 0.16 : 1,
            strokeWidth: isSelected ? 2.4 : isHighlighted ? Math.max(Number(edge.style?.strokeWidth ?? 1), 1.6) : edge.style?.strokeWidth,
            stroke: isSelected ? "#1A0F08" : edge.style?.stroke,
          },
        };
      })
  ), [activeNodeIds, baseEdges, focusMode, graph.edges, highlightedEdgeIndexes, selectedEdge, selectedNode, showLowConfidence]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const graphNode = node.data.node as GraphNode;
    setSelectedNode((current) => (current?.id === graphNode.id ? null : graphNode));
    setSelectedEdge(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const edgeIndex = Number(edge.id.replace("e-", ""));
    const graphEdge = graph.edges[edgeIndex];
    if (!graphEdge) return;

    setSelectedEdge({
      edge: graphEdge,
      sourceName: graph.nodes.find((node) => node.id === graphEdge.from)?.name ?? graphEdge.from,
      targetName: graph.nodes.find((node) => node.id === graphEdge.to)?.name ?? graphEdge.to,
    });
  }, [graph.edges, graph.nodes]);

  const serviceCount = graph.nodes.filter((node) => node.type === "service").length;
  const dbCount = graph.nodes.filter((node) => node.type === "database").length;
  const saasCount = graph.nodes.filter((node) => node.type === "saas").length;
  const externalCount = graph.nodes.filter((node) => node.type === "external").length;

  const legendEntries = Object.entries(NODE_CONFIGS).filter(([type]) => {
    if (type === "service") return serviceCount > 0;
    if (type === "database") return dbCount > 0;
    if (type === "saas") return saasCount > 0;
    if (type === "external") return externalCount > 0;
    return false;
  });

  return (
    <div style={{ flex: 1, display: "flex", background: "#FAF8F5", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          attributionPosition="bottom-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(26,15,8,0.08)" />
          <Controls style={{ background: "#fff", border: "1px solid rgba(26,15,8,0.1)", borderRadius: "10px", boxShadow: "0 2px 8px rgba(26,15,8,0.08)" }} />
          <MiniMap
            nodeColor={(node) => NODE_CONFIGS[(node.data?.node as GraphNode)?.type ?? "service"]?.color ?? "#E8754A"}
            style={{ background: "#fff", border: "1px solid rgba(26,15,8,0.1)", borderRadius: "10px" }}
          />

          <Panel position="top-left">
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              background: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(26,15,8,0.09)",
              borderRadius: "12px",
              padding: "10px",
              boxShadow: "0 1px 4px rgba(26,15,8,0.06)",
              minWidth: "214px",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                <span style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Focus
                </span>
                {selectedNode && (
                  <button
                    onClick={() => {
                      setSelectedNode(null);
                      setSelectedEdge(null);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      color: "rgba(26,15,8,0.42)",
                      fontSize: "0.72rem",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "6px",
              }}>
                {focusModes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setFocusMode(mode.id)}
                    disabled={!selectedNode && mode.id !== "full"}
                    style={{
                      border: focusMode === mode.id ? "1px solid rgba(232,117,74,0.24)" : "1px solid rgba(26,15,8,0.08)",
                      background: focusMode === mode.id ? "rgba(232,117,74,0.08)" : "#fff",
                      color: !selectedNode && mode.id !== "full" ? "rgba(26,15,8,0.24)" : focusMode === mode.id ? "#E8754A" : "rgba(26,15,8,0.55)",
                      borderRadius: "8px",
                      padding: "7px 9px",
                      cursor: !selectedNode && mode.id !== "full" ? "not-allowed" : "pointer",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <label style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                fontSize: "0.75rem",
                color: "rgba(26,15,8,0.5)",
              }}>
                <input
                  type="checkbox"
                  checked={showLowConfidence}
                  onChange={(e) => setShowLowConfidence(e.target.checked)}
                  style={{ width: "12px", height: "12px" }}
                />
                Show inferred edges
              </label>

              <p style={{ fontSize: "0.72rem", color: "rgba(26,15,8,0.36)", lineHeight: 1.5 }}>
                {selectedNode
                  ? `${selectedNode.name} is selected. Switch scope to isolate related nodes.`
                  : "Select a node to narrow the graph around its dependencies."}
              </p>
            </div>
          </Panel>

          {legendEntries.length > 0 && (
            <Panel position="bottom-left">
              <div style={{
                background: "#fff",
                border: "1px solid rgba(26,15,8,0.09)",
                borderRadius: "10px",
                padding: "10px 14px",
                boxShadow: "0 1px 4px rgba(26,15,8,0.06)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}>
                {legendEntries.map(([type, cfg]) => (
                  <div key={type} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: cfg.shape === "rect" ? "2px" : "50%", background: cfg.color, display: "block" }} />
                    <span style={{ fontSize: "11px", color: "rgba(26,15,8,0.5)" }}>{cfg.label}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {selectedEdge && (
            <Panel position="bottom-right">
              <div style={{
                width: "300px",
                background: "rgba(255,255,255,0.92)",
                border: "1px solid rgba(26,15,8,0.09)",
                borderRadius: "12px",
                padding: "12px 13px",
                boxShadow: "0 6px 24px rgba(26,15,8,0.1)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "0.72rem", color: "rgba(26,15,8,0.36)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Relationship
                  </span>
                  <button
                    onClick={() => setSelectedEdge(null)}
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: "rgba(26,15,8,0.38)", fontSize: "0.75rem" }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ fontSize: "0.84rem", color: "#1A0F08", fontWeight: 600, marginBottom: "6px", lineHeight: 1.45 }}>
                  {selectedEdge.sourceName} → {selectedEdge.targetName}
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                  <Tag text={selectedEdge.edge.type} accent={edgeAccent(selectedEdge.edge.type)} />
                  <Tag text={selectedEdge.edge.confidence} accent={confidenceAccent(selectedEdge.edge.confidence)} />
                </div>
                {selectedEdge.edge.evidence?.[0] && (
                  <>
                    <p style={{ fontSize: "0.77rem", color: "rgba(26,15,8,0.48)", lineHeight: 1.5, marginBottom: "6px" }}>
                      {selectedEdge.edge.evidence[0].detail}
                    </p>
                    <code style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.34)", fontFamily: "monospace" }}>
                      {selectedEdge.edge.evidence[0].source}
                    </code>
                  </>
                )}
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

function getFocusRelation(graph: DependencyGraph, nodeId: string, mode: FocusMode) {
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  const highlightedEdgeIndexes = new Set<number>();

  graph.edges.forEach((edge, index) => {
    if (edge.to === nodeId) {
      inbound.add(edge.from);
      highlightedEdgeIndexes.add(index);
    }
    if (edge.from === nodeId) {
      outbound.add(edge.to);
      highlightedEdgeIndexes.add(index);
    }
  });

  const highlightedNodeIds = new Set<string>([nodeId, ...inbound, ...outbound]);
  const activeNodeIds = new Set<string>(highlightedNodeIds);

  if (mode === "upstream") {
    return {
      highlightedNodeIds: new Set<string>([nodeId, ...inbound]),
      activeNodeIds: new Set<string>([nodeId, ...inbound]),
      highlightedEdgeIndexes: new Set<number>(
        graph.edges
          .map((edge, index) => ({ edge, index }))
          .filter(({ edge }) => edge.to === nodeId)
          .map(({ index }) => index)
      ),
    };
  }

  if (mode === "downstream") {
    return {
      highlightedNodeIds: new Set<string>([nodeId, ...outbound]),
      activeNodeIds: new Set<string>([nodeId, ...outbound]),
      highlightedEdgeIndexes: new Set<number>(
        graph.edges
          .map((edge, index) => ({ edge, index }))
          .filter(({ edge }) => edge.from === nodeId)
          .map(({ index }) => index)
      ),
    };
  }

  return { highlightedNodeIds, activeNodeIds, highlightedEdgeIndexes };
}

function edgeAccent(type: GraphEdge["type"]) {
  if (type === "database") return "#7C6FE0";
  if (type === "http") return "#E8754A";
  if (type === "queue") return "#D4A017";
  return "rgba(26,15,8,0.45)";
}

function confidenceAccent(confidence: GraphEdge["confidence"]) {
  if (confidence === "high") return "#27AE60";
  if (confidence === "medium") return "#D4A017";
  return "#C0392B";
}

function Tag({ text, accent }: { text: string; accent: string }) {
  return (
    <span style={{
      fontSize: "0.68rem",
      color: accent,
      background: `${accent}12`,
      border: `1px solid ${accent}22`,
      borderRadius: "999px",
      padding: "4px 8px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    }}>
      {text}
    </span>
  );
}
