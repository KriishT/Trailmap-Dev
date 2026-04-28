"use client";

import Link from "next/link";
import { GitBranch, Clock, RefreshCw, Lock, AlertTriangle, CheckCircle, XCircle, Loader } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { useState } from "react";
import { motion } from "framer-motion";

interface Snapshot { id: string; node_count: number; edge_count: number; scanned_at: string; }
interface Repo { id: string; name: string; full_name: string; last_scanned_at: string | null; private: boolean; is_active: boolean; graph_snapshots: Snapshot[]; }

export function RepoList({ repos }: { repos: Repo[] }) {
  const [scanState, setScanState] = useState<Record<string, "idle" | "scanning" | "done" | "error">>({});
  const [scanMsg, setScanMsg] = useState<Record<string, string>>({});

  async function triggerScan(repoId: string) {
    setScanState(s => ({ ...s, [repoId]: "scanning" }));
    setScanMsg(s => ({ ...s, [repoId]: "" }));
    try {
      const res = await fetch(`/api/repos/${repoId}/scan`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setScanState(s => ({ ...s, [repoId]: "error" }));
        setScanMsg(s => ({ ...s, [repoId]: data.error || "Scan failed" }));
      } else {
        setScanState(s => ({ ...s, [repoId]: "scanning" }));
        setScanMsg(s => ({ ...s, [repoId]: "Scanning… refresh in a few seconds" }));
        // Auto-refresh after 15s
        setTimeout(() => {
          window.location.reload();
        }, 15000);
      }
    } catch (e: any) {
      setScanState(s => ({ ...s, [repoId]: "error" }));
      setScanMsg(s => ({ ...s, [repoId]: e.message }));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {repos.map((repo, i) => {
        const latest = repo.graph_snapshots?.[0];
        const state = scanState[repo.id] || "idle";
        const msg = scanMsg[repo.id];

        return (
          <motion.div key={repo.id}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            style={{ background: "#FFFFFF", border: "1px solid rgba(26,15,8,0.08)", borderRadius: "14px", overflow: "hidden", boxShadow: "0 1px 4px rgba(26,15,8,0.05)" }}
          >
            <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "rgba(232,117,74,0.08)", border: "1px solid rgba(232,117,74,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <GitBranch size={14} color="#E8754A" />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                  <span className="font-body" style={{ fontSize: "0.875rem", fontWeight: 500, color: "#1A0F08", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.full_name}</span>
                  {repo.private && <span className="font-body" style={{ fontSize: "0.7rem", color: "rgba(26,15,8,0.35)", display: "flex", alignItems: "center", gap: "2px" }}><Lock size={9} /> Private</span>}
                </div>
                {latest ? (
                  <p className="font-body" style={{ fontSize: "0.75rem", color: "rgba(26,15,8,0.35)" }}>
                    <span style={{ color: "#E8754A" }}>{latest.node_count}</span> services · <span style={{ color: "#E8754A" }}>{latest.edge_count}</span> edges
                  </p>
                ) : (
                  <p className="font-body" style={{ fontSize: "0.75rem", color: "rgba(26,15,8,0.3)" }}>Pending first scan…</p>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                {repo.last_scanned_at && (
                  <span className="font-body" style={{ fontSize: "0.75rem", color: "rgba(26,15,8,0.3)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Clock size={11} /> {timeAgo(repo.last_scanned_at)}
                  </span>
                )}

                <button
                  onClick={() => triggerScan(repo.id)}
                  disabled={state === "scanning"}
                  title="Scan repo"
                  style={{ padding: "6px", borderRadius: "8px", background: "none", border: "1px solid rgba(26,15,8,0.08)", cursor: state === "scanning" ? "not-allowed" : "pointer", display: "flex", alignItems: "center", color: state === "error" ? "#C0392B" : "rgba(26,15,8,0.35)" }}
                >
                  {state === "scanning" ? <Loader size={13} className="animate-spin" /> :
                   state === "error" ? <XCircle size={13} /> :
                   state === "done" ? <CheckCircle size={13} color="#27AE60" /> :
                   <RefreshCw size={13} />}
                </button>

                {latest && (
                  <Link href={`/repos/${repo.id}`} className="btn-primary" style={{ fontSize: "0.8rem", padding: "7px 14px", textDecoration: "none" }}>
                    View map
                  </Link>
                )}
              </div>
            </div>

            {msg && (
              <div style={{ padding: "8px 18px", background: state === "error" ? "rgba(192,57,43,0.05)" : "rgba(232,117,74,0.05)", borderTop: "1px solid rgba(26,15,8,0.05)" }}>
                <p className="font-body" style={{ fontSize: "0.75rem", color: state === "error" ? "#C0392B" : "#E8754A" }}>{msg}</p>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}