"use client";

import { useEffect, useRef, useState } from "react";

const NODES = [
  { id: "api",     label: "api-gateway",       lang: "Go",         x: 320, y: 80,  color: "#E8754A", type: "service" },
  { id: "auth",    label: "auth-service",       lang: "Node.js",    x: 120, y: 200, color: "#E8754A", type: "service" },
  { id: "payment", label: "payment-service",    lang: "Python",     x: 520, y: 200, color: "#E8754A", type: "service" },
  { id: "userdb",  label: "users-db",           lang: "PostgreSQL", x: 100, y: 360, color: "#7C6FE0", type: "database" },
  { id: "redis",   label: "cache",              lang: "Redis",      x: 340, y: 340, color: "#7C6FE0", type: "database" },
  { id: "notify",  label: "notifications",      lang: "Node.js",    x: 540, y: 360, color: "#E8754A", type: "service" },
];

const EDGES = [
  { from: "api",  to: "auth",    label: "HTTP" },
  { from: "api",  to: "payment", label: "HTTP" },
  { from: "auth", to: "userdb",  label: "SQL" },
  { from: "auth", to: "redis",   label: "cache" },
  { from: "payment", to: "notify", label: "queue" },
  { from: "payment", to: "redis",  label: "cache" },
];

const LANG_COLORS: Record<string, string> = {
  "Go": "#00ADD8",
  "Node.js": "#84CC16",
  "Python": "#F59E0B",
  "PostgreSQL": "#7C6FE0",
  "Redis": "#EF4444",
};

function getNodeCenter(id: string) {
  const n = NODES.find(n => n.id === id);
  return n ? { x: n.x + 72, y: n.y + 28 } : { x: 0, y: 0 };
}

export function ArchitectureGraph() {
  const [activeEdge, setActiveEdge] = useState(0);
  const [scanPct, setScanPct] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Cycle active edge
    const interval = setInterval(() => {
      setActiveEdge(prev => (prev + 1) % EDGES.length);
    }, 1400);
    // Scan progress bar
    const scanInterval = setInterval(() => {
      setScanPct(prev => prev >= 100 ? 0 : prev + 0.6);
    }, 50);
    return () => { clearInterval(interval); clearInterval(scanInterval); };
  }, []);

  if (!mounted) return null;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", userSelect: "none" }}>
      {/* Warm radial glow backdrop */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "500px", height: "420px",
        background: "radial-gradient(ellipse at center, rgba(232,117,74,0.12) 0%, rgba(255,176,133,0.06) 40%, transparent 70%)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      {/* Top status bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        padding: "10px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid rgba(26,15,8,0.06)",
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 6px rgba(34,197,94,0.5)" }} />
          <span className="font-body" style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.45)", fontWeight: 500, letterSpacing: "0.04em" }}>
            LIVE · kriish2205/monorepo
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="font-body" style={{ fontSize: "0.65rem", color: "rgba(26,15,8,0.3)" }}>6 services · 8 edges</span>
          <div style={{
            padding: "3px 8px", borderRadius: "100px",
            background: "rgba(232,117,74,0.1)", border: "1px solid rgba(232,117,74,0.2)",
          }}>
            <span className="font-body" style={{ fontSize: "0.65rem", color: "#E8754A", fontWeight: 500 }}>Scanning</span>
          </div>
        </div>
      </div>

      {/* Scan progress */}
      <div style={{
        position: "absolute", top: "41px", left: 0, right: 0, height: "2px",
        background: "rgba(26,15,8,0.04)", zIndex: 10,
      }}>
        <div style={{
          height: "100%", width: `${scanPct}%`,
          background: "linear-gradient(90deg, #E8754A, #FFB085)",
          transition: "width 0.05s linear",
          boxShadow: "0 0 8px rgba(232,117,74,0.4)",
        }} />
      </div>

      {/* SVG for edges */}
      <svg
        style={{ position: "absolute", top: "43px", left: 0, width: "100%", height: "calc(100% - 43px)", zIndex: 1 }}
        viewBox="0 0 680 460"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(232,117,74,0.5)" />
          </marker>
          <marker id="arrow-active" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#E8754A" />
          </marker>
        </defs>

        {EDGES.map((edge, i) => {
          const from = getNodeCenter(edge.from);
          const to = getNodeCenter(edge.to);
          const isActive = i === activeEdge;
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2 - 20;

          return (
            <g key={i}>
              <path
                d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`}
                fill="none"
                stroke={isActive ? "#E8754A" : "rgba(26,15,8,0.1)"}
                strokeWidth={isActive ? 1.5 : 1}
                markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
                strokeDasharray={isActive ? "none" : "4,3"}
                style={{ transition: "all 0.4s ease" }}
              />
              {isActive && (
                <>
                  {/* Animated pulse along edge */}
                  <circle r="3" fill="#E8754A" opacity="0.9">
                    <animateMotion dur="0.9s" repeatCount="indefinite">
                      <mpath href={`#path-${i}`} />
                    </animateMotion>
                  </circle>
                  <path id={`path-${i}`} d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`} fill="none" />
                </>
              )}
              {/* Edge label */}
              <text x={mx} y={my - 4} textAnchor="middle" style={{ fontSize: "9px", fill: isActive ? "#E8754A" : "rgba(26,15,8,0.25)", fontFamily: "var(--font-body)", fontWeight: isActive ? 600 : 400, transition: "all 0.3s ease" }}>
                {edge.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Nodes */}
      <div style={{ position: "absolute", top: "43px", left: 0, right: 0, bottom: 0, zIndex: 5 }}>
        {NODES.map((node) => {
          const isConnected = EDGES[activeEdge] && (EDGES[activeEdge].from === node.id || EDGES[activeEdge].to === node.id);
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: `${(node.x / 680) * 100}%`,
                top: `${(node.y / 460) * 100}%`,
                width: "144px",
                background: "#FFFFFF",
                border: isConnected ? "1.5px solid rgba(232,117,74,0.4)" : "1px solid rgba(26,15,8,0.09)",
                borderRadius: "12px",
                padding: "8px 12px",
                boxShadow: isConnected
                  ? "0 4px 20px rgba(232,117,74,0.15), 0 1px 4px rgba(26,15,8,0.08)"
                  : "0 1px 4px rgba(26,15,8,0.06)",
                transition: "all 0.35s ease",
                cursor: "default",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                <div style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: node.type === "database" ? "#7C6FE0" : "#E8754A",
                  boxShadow: isConnected ? `0 0 6px ${node.color}80` : "none",
                  transition: "all 0.3s ease",
                }} />
                <span style={{
                  fontSize: "9px",
                  padding: "1px 5px",
                  borderRadius: "100px",
                  background: `${LANG_COLORS[node.lang] || "#E8754A"}15`,
                  color: LANG_COLORS[node.lang] || "#E8754A",
                  fontFamily: "var(--font-body)",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                }}>
                  {node.lang}
                </span>
              </div>
              <div style={{
                fontSize: "11px",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                color: isConnected ? "#1A0F08" : "rgba(26,15,8,0.7)",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                transition: "all 0.3s ease",
              }}>
                {node.label}
              </div>
              <div style={{
                fontSize: "9px",
                fontFamily: "var(--font-body)",
                color: "rgba(26,15,8,0.3)",
                marginTop: "2px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}>
                {node.type}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom stats */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        padding: "10px 16px",
        borderTop: "1px solid rgba(26,15,8,0.06)",
        display: "flex", alignItems: "center", gap: "16px",
        zIndex: 10,
      }}>
        {[
          { label: "Last scan", val: "2m ago" },
          { label: "Languages", val: "Go · Node · Python" },
          { label: "Confidence", val: "98%" },
        ].map(s => (
          <div key={s.label} style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
            <span className="font-body" style={{ fontSize: "0.65rem", color: "rgba(26,15,8,0.28)", letterSpacing: "0.05em", textTransform: "uppercase" }}>{s.label}</span>
            <span className="font-body" style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.55)", fontWeight: 500 }}>{s.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
