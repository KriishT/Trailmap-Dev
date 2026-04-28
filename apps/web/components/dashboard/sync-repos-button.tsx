"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncReposButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function sync() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/github/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sync failed");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
      <button onClick={sync} disabled={loading} className="btn-outline"
        style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.875rem" }}>
        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        {loading ? "Syncing…" : "Sync repos"}
      </button>
      {error && <p style={{ fontSize: "0.72rem", color: "#C0392B", maxWidth: "260px", textAlign: "right" }}>{error}</p>}
    </div>
  );
}