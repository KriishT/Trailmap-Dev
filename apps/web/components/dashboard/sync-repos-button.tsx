"use client";

import { Check, Github, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface SelectableRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  selected: boolean;
}

export function SyncReposButton({ label = "Add repos" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [repos, setRepos] = useState<SelectableRepo[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    void loadRepos();
  }, [open]);

  async function loadRepos() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/github/sync");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load repositories");

      setRepos(data.repos);
      setSelected(
        Object.fromEntries(
          (data.repos as SelectableRepo[]).map((repo) => [repo.id, repo.selected])
        )
      );
    } catch (e: any) {
      setError(e.message || "Could not load repositories");
    } finally {
      setLoading(false);
    }
  }

  const filteredRepos = useMemo(() => {
    const lowered = query.toLowerCase().trim();
    if (!lowered) return repos;
    return repos.filter((repo) => repo.full_name.toLowerCase().includes(lowered));
  }, [repos, query]);

  async function saveSelection() {
    setSaving(true);
    setError("");
    try {
      const selectedRepoIds = Object.entries(selected)
        .filter(([, value]) => value)
        .map(([id]) => Number(id));

      const res = await fetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedRepoIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save repository selection");

      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Could not save repository selection");
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-outline"
        style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.875rem" }}
      >
        <Github size={13} />
        {label}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,15,8,0.12)",
            backdropFilter: "blur(6px)",
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
          onClick={() => !saving && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 100%)",
              maxHeight: "82vh",
              background: "#FAF8F5",
              border: "1px solid rgba(26,15,8,0.08)",
              borderRadius: "20px",
              boxShadow: "0 24px 80px rgba(26,15,8,0.16)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "18px 20px 16px", borderBottom: "1px solid rgba(26,15,8,0.08)", background: "rgba(255,255,255,0.65)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "14px" }}>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "#E8754A", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
                    Select repositories
                  </p>
                  <h2 style={{ fontSize: "1.35rem", color: "#1A0F08", fontWeight: 700 }}>Choose what appears in Trailmap</h2>
                  <p style={{ fontSize: "0.84rem", color: "rgba(26,15,8,0.42)", marginTop: "4px", maxWidth: "520px", lineHeight: 1.5 }}>
                    Keep the workspace focused. Trailmap can see everything your GitHub App can access, but only selected repositories will show up on the dashboard.
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    background: "rgba(26,15,8,0.04)",
                    border: "1px solid rgba(26,15,8,0.08)",
                    borderRadius: "999px",
                    width: "36px",
                    height: "36px",
                    cursor: "pointer",
                    color: "rgba(26,15,8,0.45)",
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "#fff",
                  border: "1px solid rgba(26,15,8,0.08)",
                  borderRadius: "12px",
                  padding: "0 12px",
                  height: "44px",
                }}>
                  <Search size={14} color="rgba(26,15,8,0.35)" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search repositories"
                    style={{ border: "none", outline: "none", background: "transparent", width: "100%", fontSize: "0.88rem", color: "#1A0F08" }}
                  />
                </div>
                <button
                  onClick={loadRepos}
                  disabled={loading}
                  className="btn-outline"
                  style={{ height: "44px", padding: "0 16px" }}
                >
                  <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>
            </div>

            <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
              <p style={{ fontSize: "0.82rem", color: "rgba(26,15,8,0.42)" }}>
                {selectedCount} selected · {repos.length} available
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setSelected(Object.fromEntries(filteredRepos.map((repo) => [repo.id, true])))}
                  className="btn-outline"
                  style={{ padding: "8px 14px", fontSize: "0.78rem" }}
                >
                  Select visible
                </button>
                <button
                  onClick={() => setSelected(Object.fromEntries(repos.map((repo) => [repo.id, false])))}
                  className="btn-outline"
                  style={{ padding: "8px 14px", fontSize: "0.78rem" }}
                >
                  Clear all
                </button>
              </div>
            </div>

            <div style={{ padding: "16px 20px 20px", overflowY: "auto" }}>
              {loading ? (
                <div style={{ minHeight: "280px", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(26,15,8,0.42)" }}>
                  <Loader2 size={18} className="animate-spin" style={{ marginRight: "8px" }} />
                  Loading repositories...
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "12px" }}>
                  {filteredRepos.map((repo) => {
                    const isSelected = !!selected[repo.id];
                    return (
                      <button
                        key={repo.id}
                        onClick={() => setSelected((state) => ({ ...state, [repo.id]: !state[repo.id] }))}
                        style={{
                          textAlign: "left",
                          borderRadius: "18px",
                          border: isSelected ? "1px solid rgba(232,117,74,0.36)" : "1px solid rgba(26,15,8,0.08)",
                          background: isSelected ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)",
                          padding: "16px 16px 14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          minHeight: "148px",
                          cursor: "pointer",
                          boxShadow: isSelected ? "0 10px 30px rgba(232,117,74,0.08)" : "0 1px 4px rgba(26,15,8,0.04)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                          <div>
                            <div style={{ fontSize: "0.93rem", fontWeight: 600, color: "#1A0F08", lineHeight: 1.4 }}>{repo.name}</div>
                            <div style={{ fontSize: "0.76rem", color: "rgba(26,15,8,0.4)", marginTop: "4px" }}>{repo.full_name}</div>
                          </div>
                          <div style={{
                            width: "22px",
                            height: "22px",
                            borderRadius: "999px",
                            background: isSelected ? "#E8754A" : "rgba(26,15,8,0.05)",
                            color: isSelected ? "#fff" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            <Check size={12} />
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          <span style={{
                            fontSize: "0.68rem",
                            color: repo.private ? "rgba(26,15,8,0.52)" : "#E8754A",
                            background: repo.private ? "rgba(26,15,8,0.05)" : "rgba(232,117,74,0.08)",
                            border: repo.private ? "1px solid rgba(26,15,8,0.08)" : "1px solid rgba(232,117,74,0.16)",
                            borderRadius: "999px",
                            padding: "4px 8px",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}>
                            {repo.private ? "Private" : "Public"}
                          </span>
                          <span style={{
                            fontSize: "0.68rem",
                            color: "rgba(26,15,8,0.46)",
                            background: "rgba(26,15,8,0.04)",
                            border: "1px solid rgba(26,15,8,0.06)",
                            borderRadius: "999px",
                            padding: "4px 8px",
                          }}>
                            {repo.default_branch}
                          </span>
                        </div>
                        <p style={{ marginTop: "auto", fontSize: "0.78rem", color: "rgba(26,15,8,0.42)", lineHeight: 1.5 }}>
                          {isSelected ? "Selected for the dashboard and future scans." : "Available through the GitHub App, but hidden from the workspace."}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              {!loading && filteredRepos.length === 0 && (
                <div style={{ minHeight: "220px", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(26,15,8,0.42)" }}>
                  No repositories match that search.
                </div>
              )}
            </div>

            <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(26,15,8,0.08)", background: "rgba(255,255,255,0.68)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
              <div style={{ fontSize: "0.78rem", color: error ? "#C0392B" : "rgba(26,15,8,0.38)" }}>
                {error || "You can come back and change this selection any time."}
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={() => setOpen(false)} className="btn-outline" style={{ padding: "10px 16px" }}>
                  Cancel
                </button>
                <button onClick={saveSelection} disabled={saving || loading} className="btn-primary" style={{ padding: "10px 18px" }}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Save selection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
