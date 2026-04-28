"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { DependencyGraph } from "@trailmap/scanner";
import { RepoOverview } from "./repo-overview";
import { MapView } from "./map-view";
import { RepoChanges } from "./repo-changes";
import { buildGraphInsights } from "@/lib/graph-insights";

type WorkspaceMode = "overview" | "map" | "inventory" | "changes";

const modes: Array<{ id: WorkspaceMode; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "map", label: "Map" },
  { id: "inventory", label: "Inventory" },
  { id: "changes", label: "Changes" },
];

export function RepoWorkspace({
  graph,
  scannedAt,
  previousGraph,
  previousScannedAt,
}: {
  graph: DependencyGraph;
  scannedAt: string;
  previousGraph?: DependencyGraph;
  previousScannedAt?: string;
}) {
  const [mode, setMode] = useState<WorkspaceMode>("map");
  const insights = buildGraphInsights(graph);
  const serviceItems = useMemo(
    () => graph.nodes.filter((node) => node.type === "service").map((node) => `${node.name} · ${node.path || "/"}`),
    [graph.nodes]
  );
  const vendorItems = useMemo(
    () => insights.externalVendors.map((name, index) => `${name} · ${index + 1}`),
    [insights.externalVendors]
  );
  const storeItems = useMemo(
    () => insights.dataStores.map((name, index) => `${name} · ${index + 1}`),
    [insights.dataStores]
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{
        padding: "14px 20px 12px",
        borderBottom: "1px solid rgba(26,15,8,0.07)",
        background: "rgba(250,248,245,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
      }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          background: "rgba(255,255,255,0.72)",
          border: "1px solid rgba(26,15,8,0.08)",
          borderRadius: "999px",
          padding: "4px",
        }}>
          {modes.map((item) => (
            <button
              key={item.id}
              onClick={() => setMode(item.id)}
              style={{
                position: "relative",
                border: "none",
                background: "transparent",
                color: mode === item.id ? "#1A0F08" : "rgba(26,15,8,0.45)",
                fontSize: "0.82rem",
                fontWeight: 500,
                padding: "8px 14px",
                borderRadius: "999px",
                cursor: "pointer",
              }}
            >
              {mode === item.id && (
                <motion.span
                  layoutId="repo-workspace-tab"
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "999px",
                    background: "#FFFFFF",
                    boxShadow: "0 1px 4px rgba(26,15,8,0.06)",
                    border: "1px solid rgba(26,15,8,0.05)",
                  }}
                />
              )}
              <span style={{ position: "relative", zIndex: 1 }}>{item.label}</span>
            </button>
          ))}
        </div>

        <span style={{ fontSize: "0.78rem", color: "rgba(26,15,8,0.38)" }}>
          {insights.serviceCount} services · {insights.databaseCount} data stores · {insights.externalVendors.length} vendors
        </span>
      </div>

      <AnimatePresence mode="wait">
        {mode === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, overflow: "auto" }}
          >
            <RepoOverview graph={graph} scannedAt={scannedAt} />
            <div style={{ padding: "0 20px 20px" }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                marginTop: "14px",
              }}>
                <InventoryCard title="Connected services" items={serviceItems} />
                <InventoryCard title="External dependencies" items={vendorItems} />
              </div>
            </div>
          </motion.div>
        )}

        {mode === "map" && (
          <motion.div
            key="map"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, minHeight: 0, display: "flex" }}
          >
            <MapView graph={graph} />
          </motion.div>
        )}

        {mode === "inventory" && (
          <motion.div
            key="inventory"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, overflow: "auto", padding: "18px 20px 22px" }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
              <InventoryCard title="Services" items={serviceItems} />
              <InventoryCard title="Data stores" items={storeItems} />
              <InventoryCard title="Vendors" items={vendorItems} />
            </div>
          </motion.div>
        )}

        {mode === "changes" && (
          <motion.div
            key="changes"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, minHeight: 0, display: "flex" }}
          >
            <RepoChanges
              currentGraph={graph}
              previousGraph={previousGraph}
              scannedAt={scannedAt}
              previousScannedAt={previousScannedAt}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InventoryCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.82)",
      border: "1px solid rgba(26,15,8,0.08)",
      borderRadius: "18px",
      padding: "16px",
      minHeight: "240px",
    }}>
      <div style={{ fontSize: "0.74rem", color: "rgba(26,15,8,0.38)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {items.length > 0 ? items.map((item, index) => (
          <div key={`${item}-${index}`} style={{
            borderRadius: "12px",
            border: "1px solid rgba(26,15,8,0.06)",
            background: "rgba(26,15,8,0.02)",
            padding: "10px 12px",
            fontSize: "0.84rem",
            color: "rgba(26,15,8,0.58)",
          }}>
            {item}
          </div>
        )) : (
          <span style={{ fontSize: "0.82rem", color: "rgba(26,15,8,0.35)" }}>Nothing detected yet.</span>
        )}
      </div>
    </div>
  );
}
