"use client";

import { useState } from "react";
import { MapView } from "@/components/map/map-view";
import type { DependencyGraph } from "@trailmap/scanner";

export default function DevScanPage() {
  const [rootDir, setRootDir] = useState("C:\\tmp\\papermark");
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runScan() {
    setLoading(true);
    setError(null);
    setGraph(null);
    try {
      const res = await fetch("/api/dev/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      setGraph(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#FAF8F5", fontFamily: "var(--font-body), system-ui" }}>
      {/* Toolbar */}
      <div style={{
        height: "52px", padding: "0 20px",
        display: "flex", alignItems: "center", gap: "10px",
        borderBottom: "1px solid rgba(26,15,8,0.08)",
        background: "#fff", flexShrink: 0,
      }}>
        <span style={{ fontSize: "11px", color: "rgba(26,15,8,0.35)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Dev · Local Scan
        </span>
        <div style={{ width: "1px", height: "14px", background: "rgba(26,15,8,0.1)" }} />
        <input
          value={rootDir}
          onChange={e => setRootDir(e.target.value)}
          placeholder="C:\path\to\repo"
          style={{
            flex: 1, maxWidth: "480px",
            height: "30px", padding: "0 10px",
            fontSize: "12px", fontFamily: "monospace",
            border: "1px solid rgba(26,15,8,0.12)",
            borderRadius: "7px", background: "#FAF8F5",
            color: "#1A0F08", outline: "none",
          }}
        />
        <button
          onClick={runScan}
          disabled={loading}
          style={{
            height: "30px", padding: "0 16px",
            background: loading ? "rgba(232,117,74,0.4)" : "#E8754A",
            color: "#fff", border: "none", borderRadius: "7px",
            fontSize: "12px", fontWeight: 500, cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Scanning…" : "Scan"}
        </button>

        {graph && (
          <span style={{ fontSize: "11px", color: "rgba(26,15,8,0.4)" }}>
            {graph.nodes.length} nodes · {graph.edges.length} edges · {graph.meta.total_files} files
          </span>
        )}
        {error && (
          <span style={{ fontSize: "11px", color: "#E8754A" }}>{error}</span>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, display: "flex" }}>
        {graph ? (
          <MapView graph={graph} />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "13px", color: "rgba(26,15,8,0.3)" }}>
              {loading ? "Scanning — this takes a few seconds…" : "Enter a local repo path and hit Scan"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
