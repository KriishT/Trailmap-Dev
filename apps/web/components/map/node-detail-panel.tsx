"use client";

import { X, ArrowRight, ArrowLeft } from "lucide-react";
import type { DependencyGraph, GraphNode } from "@trailmap/scanner";
import { motion } from "framer-motion";
import { getNodeImpactMetrics } from "@/lib/graph-insights";

const NODE_COLORS: Record<string, string> = {
  service:  "#E8754A",
  database: "#7C6FE0",
  saas:     "#2D9CDB",
  library:  "#27AE60",
  external: "#D4A017",
};

export function NodeDetailPanel({
  node,
  graph,
  onClose,
}: {
  node: GraphNode;
  graph: DependencyGraph;
  onClose: () => void;
}) {
  const inbound = graph.edges.filter((e) => e.to === node.id);
  const outbound = graph.edges.filter((e) => e.from === node.id);
  const accentColor = NODE_COLORS[node.type] ?? "#E8754A";
  const impact = getNodeImpactMetrics(graph, node.id);

  function nodeName(id: string) {
    return graph.nodes.find((n) => n.id === id)?.name ?? id;
  }

  const meta: { label: string; value: string }[] = [
    { label: "Type", value: node.type },
    { label: "Language", value: node.language },
    ...(node.framework ? [{ label: "Framework", value: node.framework }] : []),
    ...(node.port ? [{ label: "Port", value: String(node.port) }] : []),
    { label: "Path", value: node.path || "/" },
  ];

  function confidenceColor(confidence: string) {
    if (confidence === "high") return "#27AE60";
    if (confidence === "medium") return "#D4A017";
    return "#C0392B";
  }

  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{
        width: "388px",
        flexShrink: 0,
        overflowY: "auto",
        borderLeft: "1px solid rgba(26,15,8,0.07)",
        background: "#fff",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        background: "#fff",
        borderBottom: "1px solid rgba(26,15,8,0.07)",
        zIndex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: accentColor, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: "12px", color: "#1A0F08", fontFamily: "var(--font-body)" }}>
            {node.name}
          </span>
          <span style={{
            fontSize: "9px", color: accentColor, fontWeight: 500,
            textTransform: "uppercase", letterSpacing: "0.05em",
            background: `${accentColor}12`, borderRadius: "4px", padding: "2px 6px",
          }}>
            {node.type}
          </span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(26,15,8,0.3)", padding: "2px", lineHeight: 1 }}>
          <X size={13} />
        </button>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Metadata */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {meta.map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "rgba(26,15,8,0.35)", fontFamily: "var(--font-body)" }}>{label}</span>
              <span style={{ fontSize: "11px", color: "rgba(26,15,8,0.65)", fontFamily: "var(--font-body)", fontWeight: 500, textTransform: "capitalize" }}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
          <MetricCard label="Inbound" value={impact.inboundCount} />
          <MetricCard label="Outbound" value={impact.outboundCount} />
          <MetricCard label="Blast radius" value={impact.blastRadiusCount} />
          <MetricCard label="Risk" value={impact.riskLevel.toUpperCase()} accent={confidenceColor(impact.riskLevel)} />
        </div>

        {node.evidence && node.evidence.length > 0 && (
          <div>
            <p style={{ fontSize: "9px", color: "rgba(26,15,8,0.25)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontFamily: "var(--font-body)" }}>
              Why this exists
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {node.evidence.map((item, index) => (
                <div key={`${item.kind}-${item.source}-${index}`} style={{
                  padding: "8px 9px",
                  borderRadius: "8px",
                  border: "1px solid rgba(26,15,8,0.08)",
                  background: "rgba(26,15,8,0.02)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", marginBottom: "3px" }}>
                    <span style={{ fontSize: "10px", color: "rgba(26,15,8,0.55)", fontWeight: 500, textTransform: "capitalize" }}>{item.kind.replace("-", " ")}</span>
                    <code style={{ fontSize: "9px", color: "rgba(26,15,8,0.35)", fontFamily: "monospace" }}>{item.source}</code>
                  </div>
                  <p style={{ fontSize: "10px", color: "rgba(26,15,8,0.55)", lineHeight: 1.4 }}>{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tech stack badges */}
        {node.techStack && node.techStack.length > 0 && (
          <div>
            <p style={{ fontSize: "9px", color: "rgba(26,15,8,0.25)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontFamily: "var(--font-body)" }}>Stack</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {node.techStack.map((tech) => (
                <span key={tech} style={{
                  fontSize: "10px", fontFamily: "var(--font-body)",
                  color: "rgba(26,15,8,0.5)",
                  background: "rgba(26,15,8,0.04)",
                  border: "1px solid rgba(26,15,8,0.08)",
                  borderRadius: "5px", padding: "2px 7px",
                }}>
                  {tech}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Endpoints */}
        {node.endpoints && node.endpoints.length > 0 && (
          <div>
            <p style={{ fontSize: "9px", color: "rgba(26,15,8,0.25)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontFamily: "var(--font-body)" }}>
              Endpoints ({node.endpoints.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {node.endpoints.slice(0, 8).map((ep) => (
                <code key={ep} style={{
                  display: "block", fontSize: "10px", fontFamily: "monospace",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  background: "rgba(232,117,74,0.04)",
                  border: "1px solid rgba(232,117,74,0.12)",
                  borderRadius: "5px", padding: "3px 8px",
                  color: "#E8754A",
                }}>
                  {ep}
                </code>
              ))}
              {node.endpoints.length > 8 && (
                <span style={{ fontSize: "10px", color: "rgba(26,15,8,0.25)", fontFamily: "var(--font-body)" }}>+{node.endpoints.length - 8} more</span>
              )}
            </div>
          </div>
        )}

        {/* Outbound connections */}
        {outbound.length > 0 && (
          <div>
            <p style={{ fontSize: "9px", color: "rgba(26,15,8,0.25)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: "4px" }}>
              <ArrowRight size={9} /> Outbound ({outbound.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {outbound.map((e, i) => (
                <div key={i} style={{ padding: "7px 0", borderTop: i === 0 ? "none" : "1px solid rgba(26,15,8,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "11px", color: "rgba(26,15,8,0.55)", fontFamily: "var(--font-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nodeName(e.to)}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px" }}>
                      <span style={{
                        fontSize: "9px",
                        fontFamily: "var(--font-body)",
                        color: confidenceColor(e.confidence),
                        background: `${confidenceColor(e.confidence)}12`,
                        borderRadius: "4px",
                        padding: "2px 6px",
                        textTransform: "uppercase",
                      }}>
                        {e.confidence}
                      </span>
                      <span style={{
                        fontSize: "9px", fontFamily: "var(--font-body)", flexShrink: 0,
                        color: e.type === "database" ? "#7C6FE0" : e.type === "http" ? "#E8754A" : "rgba(26,15,8,0.3)",
                        background: e.type === "database" ? "rgba(124,111,224,0.08)" : e.type === "http" ? "rgba(232,117,74,0.08)" : "rgba(26,15,8,0.04)",
                        borderRadius: "4px", padding: "2px 6px",
                      }}>
                        {e.type}
                      </span>
                    </div>
                  </div>
                  {e.evidence?.[0] && (
                    <p style={{ fontSize: "10px", color: "rgba(26,15,8,0.4)", lineHeight: 1.4, marginTop: "4px" }}>
                      {e.evidence[0].detail}
                    </p>
                  )}
                  {e.evidence?.[0] && (
                    <code style={{ fontSize: "9px", color: "rgba(26,15,8,0.28)", fontFamily: "monospace" }}>
                      {e.evidence[0].source}
                    </code>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inbound connections */}
        {inbound.length > 0 && (
          <div>
            <p style={{ fontSize: "9px", color: "rgba(26,15,8,0.25)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: "4px" }}>
              <ArrowLeft size={9} /> Inbound ({inbound.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {inbound.map((e, i) => (
                <div key={i} style={{ padding: "7px 0", borderTop: i === 0 ? "none" : "1px solid rgba(26,15,8,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "11px", color: "rgba(26,15,8,0.55)", fontFamily: "var(--font-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nodeName(e.from)}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px" }}>
                      <span style={{
                        fontSize: "9px",
                        fontFamily: "var(--font-body)",
                        color: confidenceColor(e.confidence),
                        background: `${confidenceColor(e.confidence)}12`,
                        borderRadius: "4px",
                        padding: "2px 6px",
                        textTransform: "uppercase",
                      }}>
                        {e.confidence}
                      </span>
                      <span style={{
                        fontSize: "9px", fontFamily: "var(--font-body)", flexShrink: 0,
                        color: e.type === "database" ? "#7C6FE0" : e.type === "http" ? "#E8754A" : "rgba(26,15,8,0.3)",
                        background: e.type === "database" ? "rgba(124,111,224,0.08)" : e.type === "http" ? "rgba(232,117,74,0.08)" : "rgba(26,15,8,0.04)",
                        borderRadius: "4px", padding: "2px 6px",
                      }}>
                        {e.type}
                      </span>
                    </div>
                  </div>
                  {e.evidence?.[0] && (
                    <p style={{ fontSize: "10px", color: "rgba(26,15,8,0.4)", lineHeight: 1.4, marginTop: "4px" }}>
                      {e.evidence[0].detail}
                    </p>
                  )}
                  {e.evidence?.[0] && (
                    <code style={{ fontSize: "9px", color: "rgba(26,15,8,0.28)", fontFamily: "monospace" }}>
                      {e.evidence[0].source}
                    </code>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {outbound.length === 0 && inbound.length === 0 && (
          <p style={{ fontSize: "11px", color: "rgba(26,15,8,0.25)", fontFamily: "var(--font-body)" }}>No connections detected.</p>
        )}
      </div>
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div style={{
      borderRadius: "8px",
      border: "1px solid rgba(26,15,8,0.08)",
      background: "rgba(26,15,8,0.02)",
      padding: "9px 10px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    }}>
      <span style={{ fontSize: "9px", color: "rgba(26,15,8,0.32)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: "0.86rem", color: accent ?? "#1A0F08", fontWeight: 600 }}>{value}</span>
    </div>
  );
}
