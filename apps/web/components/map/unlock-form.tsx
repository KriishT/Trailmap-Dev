"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@trailmap/ui";
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
    <form onSubmit={submit} className="stack">
      <Input label="Password" type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
      <div><Button type="submit" variant="primary" disabled={busy}>{busy ? "Checking" : "Open"}</Button></div>
    </form>
  );
}
