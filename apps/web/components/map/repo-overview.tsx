import type { CSSProperties } from "react";
import type { DependencyGraph } from "@trailmap/scanner";
import { Activity, AlertTriangle, Database, Network, Radar, ShieldAlert } from "lucide-react";
import { buildGraphInsights } from "@/lib/graph-insights";
import { timeAgo } from "@/lib/utils";

const cardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.82)",
  border: "1px solid rgba(26,15,8,0.08)",
  borderRadius: "16px",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  minHeight: "88px",
  boxShadow: "0 1px 4px rgba(26,15,8,0.05)",
};

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1480px",
  margin: "0 auto",
};

export function RepoOverview({
  graph,
  scannedAt,
}: {
  graph: DependencyGraph;
  scannedAt: string;
}) {
  const insights = buildGraphInsights(graph);

  const cards = [
    {
      label: "System shape",
      value: `${insights.serviceCount} services`,
      subtext: `${insights.databaseCount} data stores · ${insights.externalCount + insights.saasCount} external deps`,
      icon: Network,
      accent: "#E8754A",
    },
    {
      label: "Confidence",
      value: `${insights.highConfidenceEdgeCount} explicit`,
      subtext: `${insights.inferredEdgeCount} inferred edges`,
      icon: ShieldAlert,
      accent: "#27AE60",
    },
    {
      label: "Change surface",
      value: insights.topConnectedServices[0]?.name ?? "No dominant node",
      subtext: insights.topConnectedServices[0]
        ? `${insights.topConnectedServices[0].total} direct relationships`
        : "Scan a larger repo for topology",
      icon: Radar,
      accent: "#2D9CDB",
    },
    {
      label: "Freshness",
      value: timeAgo(scannedAt),
      subtext: `${graph.meta.total_files} files scanned`,
      icon: Activity,
      accent: "#7C6FE0",
    },
  ];

  return (
    <div style={{ padding: "18px 20px 16px", borderBottom: "1px solid rgba(26,15,8,0.07)", background: "rgba(250,248,245,0.92)" }}>
      <div style={shellStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "14px" }}>
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
                    {card.label}
                  </span>
                  <Icon size={13} color={card.accent} />
                </div>
                <span style={{ fontSize: "1rem", color: "#1A0F08", fontWeight: 600 }}>{card.value}</span>
                <span style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.42)", lineHeight: 1.45 }}>{card.subtext}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr) minmax(280px, 1fr)", gap: "12px" }}>
          <div style={{ ...cardStyle, minHeight: "unset" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertTriangle size={13} color="#E8754A" />
              <span style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
                Architecture summary
              </span>
            </div>
            <p style={{ fontSize: "0.83rem", color: "rgba(26,15,8,0.58)", lineHeight: 1.6 }}>{insights.summary}</p>
          </div>

          <div style={{ ...cardStyle, minHeight: "unset" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Database size={13} color="#7C6FE0" />
              <span style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
                Inventory
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {insights.dataStores.slice(0, 2).map((name) => (
                <span key={name} style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.58)" }}>{name}</span>
              ))}
              {insights.externalVendors.slice(0, 2).map((name) => (
                <span key={name} style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.58)" }}>{name}</span>
              ))}
              {insights.dataStores.length + insights.externalVendors.length === 0 && (
                <span style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.35)" }}>No infra or vendors detected</span>
              )}
            </div>
          </div>

          <div style={{ ...cardStyle, minHeight: "unset" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <ShieldAlert size={13} color="#D4A017" />
              <span style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
                Watch list
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {insights.riskiestServices.map((service) => (
                <div key={service.id} style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.62)" }}>{service.name}</span>
                  <span
                    style={{
                      fontSize: "0.67rem",
                      color: service.riskLevel === "high" ? "#C0392B" : service.riskLevel === "medium" ? "#D4A017" : "#27AE60",
                      background: service.riskLevel === "high" ? "rgba(192,57,43,0.08)" : service.riskLevel === "medium" ? "rgba(212,160,23,0.1)" : "rgba(39,174,96,0.08)",
                      borderRadius: "999px",
                      padding: "3px 7px",
                      textTransform: "uppercase",
                    }}
                  >
                    {service.riskLevel}
                  </span>
                </div>
              ))}
              {insights.riskiestServices.length === 0 && (
                <span style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.35)" }}>No risky services surfaced yet</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
