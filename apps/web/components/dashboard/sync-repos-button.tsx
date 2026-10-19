"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Input, Loading } from "@trailmap/ui";
import { errorMessage } from "@/lib/errors";

interface SelectableRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  selected: boolean;
}

/** Choose which of the repositories the GitHub App can see belong in this workspace. */
export function SyncReposButton({ label = "Choose repositories", variant = "default" }: { label?: string; variant?: "default" | "primary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<SelectableRepo[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch("/api/github/sync")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load repositories");
        setRepos(data.repos);
        setSelected(Object.fromEntries((data.repos as SelectableRepo[]).map((r) => [r.id, r.selected])));
      })
      .catch((e) => setError(errorMessage(e, "Could not load repositories")))
      .finally(() => setLoading(false));
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;
  }, [repos, query]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const selectedRepoIds = Object.entries(selected).filter(([, v]) => v).map(([id]) => Number(id));
      const res = await fetch("/api/github/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedRepoIds }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the selection");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, "Could not save the selection"));
    } finally {
      setSaving(false);
    }
  }

  const count = Object.values(selected).filter(Boolean).length;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)} title="Choose repositories" description="Only the repositories you tick appear in this workspace. Trailmap reads code to build the graph, keeps only the graph, and deletes its temporary copy.">
        <div className="stack">
          <Input label="Filter" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="acme/shop" />
          {loading ? <Loading label="Loading repositories" height={120} /> : (
            <fieldset style={{ border: 0, padding: 0, margin: 0, maxHeight: "34vh", overflow: "auto" }}>
              <legend className="sr-only">Repositories</legend>
              {shown.length === 0 ? <p className="muted">No repositories match. If a repository is missing, check that the GitHub App is installed on it.</p> : null}
              {shown.map((r) => (
                <label key={r.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--rule)" }}>
                  <input type="checkbox" checked={Boolean(selected[r.id])} onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })} />
                  <span className="mono">{r.full_name}</span>
                  {r.private ? <span className="stamp stamp-plain">private</span> : null}
                </label>
              ))}
            </fieldset>
          )}
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </div>
        <div className="actions">
          <Button variant="quiet" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || loading}>{saving ? "Saving" : `Save ${count} selected`}</Button>
        </div>
      </Dialog>
    </>
  );
}
