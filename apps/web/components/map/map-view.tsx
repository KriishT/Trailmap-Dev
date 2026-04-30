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
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { DependencyGraph, GraphEdge, GraphNode } from "@trailmap/scanner";
import { NodeDetailPanel } from "./node-detail-panel";
import { timeAgo } from "@/lib/utils";

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
const NODE_HEIGHT = 62;
const SECONDARY_WIDTH = 136;
const SECONDARY_HEIGHT = 56;
const LARGE_GRAPH_NODE_THRESHOLD = 45;
const LARGE_GRAPH_EDGE_THRESHOLD = 90;
const CONDENSIBLE_TYPES: Array<GraphNode["type"]> = ["external", "saas"];
const MAX_VISIBLE_DEPENDENCIES_PER_TYPE = 8;

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
  if (graph.nodes.length >= LARGE_GRAPH_NODE_THRESHOLD || graph.edges.length >= LARGE_GRAPH_EDGE_THRESHOLD) {
    return layoutLargeGraph(graph);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 132, ranksep: 170, marginx: 36, marginy: 36 });

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
          background: "rgba(255,255,255,0.96)",
          border: `${isService ? "1.5px" : "1px"} solid ${cfg.color}${isService ? "7A" : "42"}`,
          borderRadius,
          color: "#1A0F08",
          fontSize: isService ? "12px" : "11px",
          fontFamily: "var(--font-body), system-ui, sans-serif",
          fontWeight: isService ? 500 : 400,
          width,
          height,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
          padding: "0",
          boxShadow: isService
            ? `0 18px 32px ${cfg.color}12, 0 2px 10px rgba(26,15,8,0.05)`
            : `0 12px 26px ${cfg.color}0F, 0 2px 8px rgba(26,15,8,0.04)`,
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

function layoutLargeGraph(graph: DependencyGraph): { nodes: Node[]; edges: Edge[] } {
  const serviceLikeNodes = graph.nodes.filter((node) => node.type === "service" || node.type === "library");
  const serviceLikeIds = new Set(serviceLikeNodes.map((node) => node.id));
  const serviceEdges = graph.edges.filter((edge) => serviceLikeIds.has(edge.from) && serviceLikeIds.has(edge.to));

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 240, ranksep: 238, marginx: 56, marginy: 56 });

  for (const node of serviceLikeNodes) {
    const isService = node.type === "service";
    g.setNode(node.id, {
      width: isService ? NODE_WIDTH : SECONDARY_WIDTH,
      height: isService ? NODE_HEIGHT : SECONDARY_HEIGHT,
    });
  }

  for (const edge of serviceEdges) g.setEdge(edge.from, edge.to);
  dagre.layout(g);

  const positions = buildStructuredPositions(graph, serviceLikeNodes, g);
  return buildFlowGraph(graph, positions);
}

function buildStructuredPositions(
  graph: DependencyGraph,
  serviceLikeNodes: GraphNode[],
  dagreGraph: dagre.graphlib.Graph
) {
  const positions = new Map<string, { x: number; y: number }>();
  const serviceRows = clusterServiceRows(serviceLikeNodes, dagreGraph);

  const serviceRowGap = 238;
  const serviceNodeGap = 68;

  serviceRows.forEach((row, rowIndex) => {
    const rowWidth = row.reduce((sum, node, index) => {
      const width = node.type === "service" ? NODE_WIDTH : SECONDARY_WIDTH;
      return sum + width + (index > 0 ? serviceNodeGap : 0);
    }, 0);

    let cursorX = -rowWidth / 2;
    const y = rowIndex * serviceRowGap;

    row.forEach((node) => {
      const width = node.type === "service" ? NODE_WIDTH : SECONDARY_WIDTH;
      positions.set(node.id, { x: cursorX + width / 2, y });
      cursorX += width + serviceNodeGap;
    });
  });

  const dependencyTargets = buildDesiredXTargets(graph, positions);
  const serviceBandTop = serviceRows.length > 0 ? 0 : 0;
  const serviceBandBottom = serviceRows.length > 0 ? (serviceRows.length - 1) * serviceRowGap : 0;

  placeBandNodes(
    graph.nodes.filter((node) => node.type === "database"),
    dependencyTargets,
    positions,
    serviceBandBottom + 210,
    SECONDARY_WIDTH,
    36,
    1500
  );

  placeBandNodes(
    graph.nodes.filter((node) => node.type === "saas"),
    dependencyTargets,
    positions,
    serviceBandBottom + 324,
    SECONDARY_WIDTH,
    36,
    1500
  );

  placeBandNodes(
    graph.nodes.filter((node) => node.type === "external"),
    dependencyTargets,
    positions,
    serviceBandBottom + 438,
    SECONDARY_WIDTH,
    36,
    1500
  );

  placeBandNodes(
    graph.nodes.filter((node) => node.type === "library" && !positions.has(node.id)),
    dependencyTargets,
    positions,
    serviceBandTop - 132,
    SECONDARY_WIDTH,
    36,
    1500
  );

  normalizePositions(positions, 72, 72);
  return positions;
}

function clusterServiceRows(serviceLikeNodes: GraphNode[], dagreGraph: dagre.graphlib.Graph) {
  const positioned = serviceLikeNodes
    .map((node) => ({ node, pos: dagreGraph.node(node.id) }))
    .filter((entry) => entry.pos)
    .sort((a, b) => {
      const deltaY = (a.pos.y as number) - (b.pos.y as number);
      if (Math.abs(deltaY) > 24) return deltaY;
      return (a.pos.x as number) - (b.pos.x as number);
    });

  if (positioned.length === 0) return [serviceLikeNodes];

  const rows: GraphNode[][] = [];
  let currentRow: GraphNode[] = [];
  let currentAnchorY = positioned[0].pos.y as number;

  positioned.forEach(({ node, pos }) => {
    if (currentRow.length === 0 || Math.abs((pos.y as number) - currentAnchorY) <= 80) {
      currentRow.push(node);
      currentAnchorY = currentRow.length === 1 ? (pos.y as number) : currentAnchorY;
      return;
    }

    rows.push(currentRow.sort((left, right) => {
      const leftPos = dagreGraph.node(left.id);
      const rightPos = dagreGraph.node(right.id);
      return (leftPos.x as number) - (rightPos.x as number);
    }));
    currentRow = [node];
    currentAnchorY = pos.y as number;
  });

  if (currentRow.length > 0) {
    rows.push(currentRow.sort((left, right) => {
      const leftPos = dagreGraph.node(left.id);
      const rightPos = dagreGraph.node(right.id);
      return (leftPos.x as number) - (rightPos.x as number);
    }));
  }

  return rows;
}

function buildDesiredXTargets(graph: DependencyGraph, knownPositions: Map<string, { x: number; y: number }>) {
  const targets = new Map<string, number>();

  graph.nodes.forEach((node, index) => {
    if (knownPositions.has(node.id)) {
      targets.set(node.id, knownPositions.get(node.id)!.x);
      return;
    }

    const neighbors = graph.edges
      .filter((edge) => edge.from === node.id || edge.to === node.id)
      .map((edge) => (edge.from === node.id ? edge.to : edge.from))
      .map((neighborId) => knownPositions.get(neighborId)?.x)
      .filter((x): x is number => typeof x === "number");

    if (neighbors.length > 0) {
      targets.set(node.id, neighbors.reduce((sum, x) => sum + x, 0) / neighbors.length);
      return;
    }

    targets.set(node.id, index * 180);
  });

  return targets;
}

function placeBandNodes(
  nodes: GraphNode[],
  targets: Map<string, number>,
  positions: Map<string, { x: number; y: number }>,
  startY: number,
  width: number,
  height: number,
  maxRowWidth: number
) {
  if (nodes.length === 0) return;

  const gap = 28;
  const rowGap = height + 26;
  const sorted = [...nodes].sort((left, right) => (targets.get(left.id) ?? 0) - (targets.get(right.id) ?? 0));

  let rowIndex = 0;
  let rowStartX = -maxRowWidth / 2;
  let cursorX = rowStartX;
  let rowNodes: Array<{ node: GraphNode; targetX: number }> = [];

  const flushRow = () => {
    if (rowNodes.length === 0) return;

    const rowWidth = rowNodes.length * width + (rowNodes.length - 1) * gap;
    let rowCursor = -rowWidth / 2;

    rowNodes.forEach(({ node }) => {
      positions.set(node.id, {
        x: rowCursor + width / 2,
        y: startY + rowIndex * rowGap,
      });
      rowCursor += width + gap;
    });

    rowNodes = [];
    rowIndex += 1;
    cursorX = rowStartX;
  };

  sorted.forEach((node) => {
    const targetX = targets.get(node.id) ?? 0;
    const projectedX = Math.max(cursorX, targetX - width / 2);

    if (projectedX + width - rowStartX > maxRowWidth && rowNodes.length > 0) {
      flushRow();
    }

    rowNodes.push({ node, targetX });
    cursorX = Math.max(cursorX, targetX - width / 2) + width + gap;
  });

  flushRow();
}

function normalizePositions(positions: Map<string, { x: number; y: number }>, marginX: number, marginY: number) {
  if (positions.size === 0) return;

  const xs = Array.from(positions.values()).map((pos) => pos.x);
  const ys = Array.from(positions.values()).map((pos) => pos.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  positions.forEach((pos, id) => {
    positions.set(id, {
      x: pos.x - minX + marginX,
      y: pos.y - minY + marginY,
    });
  });
}

function buildFlowGraph(graph: DependencyGraph, positions: Map<string, { x: number; y: number }>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes
    .map((node) => {
      const pos = positions.get(node.id);
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
          background: "rgba(255,255,255,0.96)",
          border: `${isService ? "1.5px" : "1px"} solid ${cfg.color}${isService ? "7A" : "42"}`,
          borderRadius,
          color: "#1A0F08",
          fontSize: isService ? "12px" : "11px",
          fontFamily: "var(--font-body), system-ui, sans-serif",
          fontWeight: isService ? 500 : 400,
          width,
          height,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
          padding: "0",
          boxShadow: isService
            ? `0 18px 32px ${cfg.color}12, 0 2px 10px rgba(26,15,8,0.05)`
            : `0 12px 26px ${cfg.color}0F, 0 2px 8px rgba(26,15,8,0.04)`,
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

  const targetWidth = 2800;
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
  const tag = node.framework ?? (node.type === "service" ? "service" : cfg.label);
  const subtleStack = node.techStack?.slice(0, 1)[0];
  const isService = node.type === "service";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: isService ? "8px 10px 8px" : "7px 9px 7px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minHeight: "16px" }}>
        <span
          style={{
            width: isService ? "7px" : "6px",
            height: isService ? "7px" : "6px",
            borderRadius: "999px",
            background: cfg.color,
            boxShadow: `0 0 0 4px ${cfg.color}14`,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: isService ? "9px" : "8px",
            color: cfg.color,
            fontWeight: 500,
            background: `${cfg.color}10`,
            border: `1px solid ${cfg.color}18`,
            borderRadius: "999px",
            padding: isService ? "2px 7px" : "2px 6px",
            textTransform: "capitalize",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: isService ? "102px" : "88px",
          }}
        >
          {tag}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: isService ? "2px" : "1px",
          minWidth: 0,
          marginTop: isService ? "-1px" : "-2px",
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: isService ? "11px" : "10px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: isService ? "144px" : "114px",
          }}
        >
          {node.name}
        </span>
        <span
          style={{
            fontSize: isService ? "8px" : "7px",
            color: "rgba(26,15,8,0.34)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: isService ? "144px" : "114px",
          }}
        >
          {cfg.label}
          {subtleStack && isService ? ` · ${subtleStack}` : ""}
        </span>
      </div>
    </div>
  );
}

export function MapView({ graph }: { graph: DependencyGraph }) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdgeState | null>(null);
  const [showLowConfidence, setShowLowConfidence] = useState(false);
  const [focusMode, setFocusMode] = useState<FocusMode>("full");
  const [condenseLargeGraph, setCondenseLargeGraph] = useState(true);
  const isLargeGraph = graph.nodes.length >= LARGE_GRAPH_NODE_THRESHOLD || graph.edges.length >= LARGE_GRAPH_EDGE_THRESHOLD;
  const displayGraph = useMemo(
    () => (isLargeGraph && condenseLargeGraph ? condenseGraph(graph) : graph),
    [condenseLargeGraph, graph, isLargeGraph]
  );
  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => layoutGraph(displayGraph), [displayGraph]);

  useEffect(() => {
    if (selectedNode && !displayGraph.nodes.some((node) => node.id === selectedNode.id)) {
      setSelectedNode(null);
    }
  }, [displayGraph.nodes, selectedNode]);

  const relation = selectedNode ? getFocusRelation(displayGraph, selectedNode.id, focusMode) : null;
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
      .map((edge, index) => ({ edge, index, graphEdge: displayGraph.edges[index] }))
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
  ), [activeNodeIds, baseEdges, displayGraph.edges, focusMode, highlightedEdgeIndexes, selectedEdge, selectedNode, showLowConfidence]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const graphNode = node.data.node as GraphNode;
    setSelectedNode((current) => (current?.id === graphNode.id ? null : graphNode));
    setSelectedEdge(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const edgeIndex = Number(edge.id.replace("e-", ""));
    const graphEdge = displayGraph.edges[edgeIndex];
    if (!graphEdge) return;

    setSelectedEdge({
      edge: graphEdge,
      sourceName: displayGraph.nodes.find((node) => node.id === graphEdge.from)?.name ?? graphEdge.from,
      targetName: displayGraph.nodes.find((node) => node.id === graphEdge.to)?.name ?? graphEdge.to,
    });
  }, [displayGraph.edges, displayGraph.nodes]);

  const serviceCount = displayGraph.nodes.filter((node) => node.type === "service").length;
  const dbCount = displayGraph.nodes.filter((node) => node.type === "database").length;
  const saasCount = displayGraph.nodes.filter((node) => node.type === "saas").length;
  const externalCount = displayGraph.nodes.filter((node) => node.type === "external").length;
  const languages = Object.entries(graph.meta.language_breakdown ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([language]) => language)
    .join(" · ");
  const confidenceScore = graph.edges.length
    ? Math.round(
        (((graph.edges.filter((edge) => edge.confidence === "high").length * 1) +
          (graph.edges.filter((edge) => edge.confidence === "medium").length * 0.72) +
          (graph.edges.filter((edge) => edge.confidence === "low").length * 0.38)) /
          graph.edges.length) *
          100
      )
    : 100;
  const legendEntries = Object.entries(NODE_CONFIGS).filter(([type]) => {
    if (type === "service") return serviceCount > 0;
    if (type === "database") return dbCount > 0;
    if (type === "saas") return saasCount > 0;
    if (type === "external") return externalCount > 0;
    return false;
  });

  return (
    <div style={{ flex: 1, display: "flex", background: "#FAF8F5", minHeight: 0 }}>
      <div style={{ width: "100%", minWidth: 0 }}>
        <div
          style={{
            position: "relative",
            background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.92))",
            borderTop: "1px solid rgba(26,15,8,0.08)",
            borderBottom: "1px solid rgba(26,15,8,0.08)",
            overflow: "hidden",
            boxShadow: "none",
            minHeight: "740px",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "0 0 42px 0",
              background:
                "radial-gradient(circle at 50% 38%, rgba(232,117,74,0.10), transparent 22%), radial-gradient(circle at 52% 46%, rgba(124,111,224,0.06), transparent 34%)",
            }}
          />

          <div style={{ position: "relative", height: "680px" }}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          fitViewOptions={{ padding: 0.24, minZoom: 0.18, maxZoom: 1.35 }}
          attributionPosition="bottom-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={30} size={1} color="rgba(26,15,8,0.07)" />
          <Controls
            style={{
              background: "rgba(255,255,255,0.92)",
              border: "1px solid rgba(26,15,8,0.1)",
              borderRadius: "14px",
              boxShadow: "0 10px 28px rgba(26,15,8,0.08)",
              overflow: "hidden",
            }}
          />
          <MiniMap
            nodeColor={(node) => NODE_CONFIGS[(node.data?.node as GraphNode)?.type ?? "service"]?.color ?? "#E8754A"}
            style={{
              background: "rgba(255,255,255,0.92)",
              border: "1px solid rgba(26,15,8,0.1)",
              borderRadius: "16px",
              boxShadow: "0 12px 30px rgba(26,15,8,0.08)",
            }}
          />

          <Panel position="top-left">
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              background: "rgba(255,255,255,0.92)",
              border: "1px solid rgba(26,15,8,0.09)",
              borderRadius: "16px",
              padding: "12px",
              boxShadow: "0 14px 34px rgba(26,15,8,0.08)",
              minWidth: "240px",
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
                      borderRadius: "14px",
                      padding: "8px 10px",
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

              {isLargeGraph && (
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
                    checked={condenseLargeGraph}
                    onChange={(e) => setCondenseLargeGraph(e.target.checked)}
                    style={{ width: "12px", height: "12px" }}
                  />
                  Condense low-signal dependencies
                </label>
              )}

              <p style={{ fontSize: "0.72rem", color: "rgba(26,15,8,0.36)", lineHeight: 1.5 }}>
                {selectedNode
                  ? `${selectedNode.name} is selected. Switch scope to isolate related nodes.`
                  : isLargeGraph && condenseLargeGraph
                    ? "Large graph mode is condensing repeated vendor nodes so the main service structure stays readable."
                    : "Select a node to narrow the graph around its dependencies."}
              </p>
            </div>
          </Panel>

          {legendEntries.length > 0 && (
            <Panel position="bottom-left">
              <div style={{
                background: "rgba(255,255,255,0.92)",
                border: "1px solid rgba(26,15,8,0.09)",
                borderRadius: "14px",
                padding: "10px 14px",
                boxShadow: "0 14px 34px rgba(26,15,8,0.08)",
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
                borderRadius: "16px",
                padding: "12px 13px",
                boxShadow: "0 14px 34px rgba(26,15,8,0.1)",
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
                  {selectedEdge.sourceName} to {selectedEdge.targetName}
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

          <div
            style={{
              height: "40px",
              borderTop: "1px solid rgba(26,15,8,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              padding: "0 16px",
              background: "rgba(255,255,255,0.78)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", minWidth: 0 }}>
              <FooterMeta label="Last scan" value={timeAgo(graph.meta.scanned_at)} />
              {languages && <FooterMeta label="Languages" value={languages} />}
              <FooterMeta label="Confidence" value={`${confidenceScore}%`} />
            </div>
            <div style={{ fontSize: "0.76rem", color: "rgba(26,15,8,0.36)" }}>
              {dbCount} data stores · {externalCount + saasCount} dependencies
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selectedNode && (
          <NodeDetailPanel node={selectedNode} graph={displayGraph} onClose={() => setSelectedNode(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function FooterMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ fontSize: "0.68rem", color: "rgba(26,15,8,0.32)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.58)" }}>{value}</span>
    </div>
  );
}

function condenseGraph(graph: DependencyGraph): DependencyGraph {
  const degreeByNode = new Map<string, number>();
  graph.nodes.forEach((node) => degreeByNode.set(node.id, 0));
  graph.edges.forEach((edge) => {
    degreeByNode.set(edge.from, (degreeByNode.get(edge.from) ?? 0) + 1);
    degreeByNode.set(edge.to, (degreeByNode.get(edge.to) ?? 0) + 1);
  });

  const hiddenIds = new Set<string>();
  const summaryNodes: GraphNode[] = [];
  const summaryByType = new Map<string, GraphNode>();

  for (const type of CONDENSIBLE_TYPES) {
    const nodesOfType = graph.nodes
      .filter((node) => node.type === type)
      .sort((left, right) => {
        const degreeDelta = (degreeByNode.get(right.id) ?? 0) - (degreeByNode.get(left.id) ?? 0);
        if (degreeDelta !== 0) return degreeDelta;
        return left.name.localeCompare(right.name);
      });

    if (nodesOfType.length <= MAX_VISIBLE_DEPENDENCIES_PER_TYPE + 3) continue;

    const visible = nodesOfType.slice(0, MAX_VISIBLE_DEPENDENCIES_PER_TYPE);
    const hidden = nodesOfType.slice(MAX_VISIBLE_DEPENDENCIES_PER_TYPE);
    hidden.forEach((node) => hiddenIds.add(node.id));

    const summaryNode: GraphNode = {
      id: `summary-${type}`,
      name: `+${hidden.length} more ${type === "external" ? "vendors" : "SaaS tools"}`,
      type,
      language: "unknown",
      port: null,
      endpoints: [],
      path: "",
      framework: undefined,
      techStack: [],
      evidence: [
        {
          kind: "package-classification" as const,
          source: "summary",
          detail: `Collapsed ${hidden.length} lower-signal ${type} node${hidden.length === 1 ? "" : "s"} to keep the large graph readable. Examples: ${hidden.slice(0, 5).map((node) => node.name).join(", ")}${hidden.length > 5 ? ", and more." : "."}`,
        },
      ],
    };

    summaryNodes.push(summaryNode);
    summaryByType.set(type, summaryNode);
  }

  if (hiddenIds.size === 0) return graph;

  const visibleNodes = graph.nodes.filter((node) => !hiddenIds.has(node.id));
  const edgeMap = new Map<string, GraphEdge>();

  const upsertEdge = (edge: GraphEdge) => {
    const key = `${edge.from}::${edge.to}::${edge.type}`;
    const existing = edgeMap.get(key);
    if (!existing) {
      edgeMap.set(key, edge);
      return;
    }

    existing.confidence = strongerConfidence(existing.confidence, edge.confidence);
    existing.evidence = [...(existing.evidence ?? []), ...(edge.evidence ?? [])].slice(0, 6);
  };

  graph.edges.forEach((edge) => {
    const fromHidden = hiddenIds.has(edge.from);
    const toHidden = hiddenIds.has(edge.to);

    if (fromHidden && toHidden) return;

    const fromNode = graph.nodes.find((node) => node.id === edge.from);
    const toNode = graph.nodes.find((node) => node.id === edge.to);
    const mappedFrom = fromHidden && fromNode ? summaryByType.get(fromNode.type)?.id : edge.from;
    const mappedTo = toHidden && toNode ? summaryByType.get(toNode.type)?.id : edge.to;

    if (!mappedFrom || !mappedTo || mappedFrom === mappedTo) return;

    upsertEdge({
      ...edge,
      from: mappedFrom,
      to: mappedTo,
      evidence: (fromHidden || toHidden)
        ? [
            {
              kind: "package-classification" as const,
              source: "summary",
              detail: "This edge represents one or more collapsed low-signal dependencies in large-graph mode.",
            },
            ...(edge.evidence ?? []),
          ].slice(0, 4)
        : edge.evidence,
    });
  });

  return {
    ...graph,
    nodes: [...visibleNodes, ...summaryNodes],
    edges: [...edgeMap.values()],
  };
}

function strongerConfidence(left: GraphEdge["confidence"], right: GraphEdge["confidence"]): GraphEdge["confidence"] {
  const order = { low: 1, medium: 2, high: 3 };
  return order[right] > order[left] ? right : left;
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
