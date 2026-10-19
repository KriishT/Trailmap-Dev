"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/errors";

export function UnlockForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/maps/${encodeURIComponent(slug)}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not unlock this link");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, width: "min(360px, 100%)" }}>
      <label htmlFor="share-password" style={{ fontWeight: 600 }}>Password</label>
      <input
        id="share-password"
        type="password"
        autoComplete="off"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ padding: "10px 12px", border: "1px solid #888", borderRadius: 2, font: "inherit" }}
      />
      {error && <p role="alert" style={{ color: "#b3261e", margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy} style={{ padding: "10px 12px", border: 0, borderRadius: 2, background: "#15171B", color: "#fff", font: "inherit", cursor: "pointer" }}>
        {busy ? "Checking..." : "Open"}
      </button>
    </form>
  );
}
