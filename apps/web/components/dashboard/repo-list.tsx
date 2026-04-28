"use client";

import Link from "next/link";
import { Clock3, GitBranch, Lock, RefreshCw, Loader2, ArrowUpRight } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { useState } from "react";
import { motion } from "framer-motion";

interface Snapshot {
  id: string;
  node_count: number;
  edge_count: number;
  scanned_at: string;
}

interface Repo {
  id: string;
  name: string;
  full_name: string;
  last_scanned_at: string | null;
  private: boolean;
  is_active: boolean;
  graph_snapshots: Snapshot[];
}

export function RepoList({ repos }: { repos: Repo[] }) {
  const [scanState, setScanState] = useState<Record<string, "idle" | "scanning" | "error">>({});
  const [scanMsg, setScanMsg] = useState<Record<string, string>>({});

  async function triggerScan(repoId: string) {
    setScanState((state) => ({ ...state, [repoId]: "scanning" }));
    setScanMsg((state) => ({ ...state, [repoId]: "" }));
    try {
      const res = await fetch(`/api/repos/${repoId}/scan`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setScanState((state) => ({ ...state, [repoId]: "error" }));
        setScanMsg((state) => ({ ...state, [repoId]: data.error || "Scan failed" }));
        return;
      }

      setScanMsg((state) => ({ ...state, [repoId]: "Scanning now. Refreshing shortly..." }));
      setTimeout(() => window.location.reload(), 15000);
    } catch (e: any) {
      setScanState((state) => ({ ...state, [repoId]: "error" }));
      setScanMsg((state) => ({ ...state, [repoId]: e.message || "Scan failed" }));
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "14px" }}>
      {repos.map((repo, index) => {
        const latest = repo.graph_snapshots?.[0];
        const status = scanState[repo.id] ?? "idle";
        const hasScan = !!latest;

        return (
          <motion.div
            key={repo.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: index * 0.03 }}
            style={{
              background: "#FFFFFF",
              border: "1px solid rgba(26,15,8,0.08)",
              borderRadius: "20px",
              padding: "18px 18px 16px",
              minHeight: "220px",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 1px 4px rgba(26,15,8,0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "14px" }}>
              <div style={{ width: "38px", height: "38px", borderRadius: "12px", background: "rgba(232,117,74,0.08)", border: "1px solid rgba(232,117,74,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <GitBranch size={15} color="#E8754A" />
              </div>

              <button
                onClick={() => triggerScan(repo.id)}
                disabled={status === "scanning"}
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "10px",
                  background: "rgba(26,15,8,0.03)",
                  border: "1px solid rgba(26,15,8,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: status === "scanning" ? "not-allowed" : "pointer",
                  color: status === "error" ? "#C0392B" : "rgba(26,15,8,0.38)",
                }}
                title="Trigger scan"
              >
                {status === "scanning" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
            </div>

            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                <h3 style={{ fontSize: "1.03rem", fontWeight: 600, color: "#1A0F08", lineHeight: 1.35 }}>{repo.name}</h3>
                {repo.private && (
                  <span style={{ fontSize: "0.68rem", color: "rgba(26,15,8,0.42)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <Lock size={10} /> Private
                  </span>
                )}
              </div>
              <p style={{ fontSize: "0.8rem", color: "rgba(26,15,8,0.38)", lineHeight: 1.5 }}>{repo.full_name}</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", marginBottom: "14px" }}>
              <StatCard label="Services" value={latest?.node_count ?? "—"} accent="#E8754A" />
              <StatCard label="Edges" value={latest?.edge_count ?? "—"} accent="#7C6FE0" />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px", minHeight: "18px" }}>
              <Clock3 size={12} color="rgba(26,15,8,0.35)" />
              <span style={{ fontSize: "0.76rem", color: "rgba(26,15,8,0.38)" }}>
                {repo.last_scanned_at ? `Last scan ${timeAgo(repo.last_scanned_at)}` : "Pending first scan"}
              </span>
            </div>

            <div style={{ marginTop: "auto" }}>
              {scanMsg[repo.id] && (
                <p style={{ fontSize: "0.74rem", color: status === "error" ? "#C0392B" : "#E8754A", marginBottom: "10px", lineHeight: 1.45 }}>
                  {scanMsg[repo.id]}
                </p>
              )}

              <Link
                href={hasScan ? `/repos/${repo.id}` : "/dashboard"}
                className={hasScan ? "btn-primary" : "btn-outline"}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "11px 16px",
                  fontSize: "0.84rem",
                  textDecoration: "none",
                }}
              >
                {hasScan ? (
                  <>
                    Open map
                    <ArrowUpRight size={14} />
                  </>
                ) : (
                  "Run first scan"
                )}
              </Link>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div style={{
      borderRadius: "14px",
      border: "1px solid rgba(26,15,8,0.08)",
      background: "rgba(26,15,8,0.025)",
      padding: "12px 12px 10px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    }}>
      <span style={{ fontSize: "0.67rem", color: "rgba(26,15,8,0.34)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: "1rem", color: accent, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
