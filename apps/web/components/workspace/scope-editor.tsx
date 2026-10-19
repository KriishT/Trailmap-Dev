"use client";

import { useMemo, useState } from "react";
import { Button, Input, Select } from "@trailmap/ui";
import { call, DEMO_NOTE, type Ctx } from "./api";
import { Inspector, type Decision } from "./inspector";
import { SheetViewer, type Selection } from "./sheet-viewer";

const NEW = "__new__";

/**
 * Scope editor. A scope is the set of boxes that hold or touch cardholder data (or whatever the
 * framework cares about). The drawing previews the hatched region while you edit.
 */
export function ScopesTab({ ctx, endpoint, selection, onSelect, onDecide }: { ctx: Ctx; endpoint: string; selection: Selection; onSelect: (s: Selection) => void; onDecide: (d: Decision, reason: string) => Promise<string | null> }) {
  const { data, base } = ctx;
  const saved = data.scopes;
  const [editingId, setEditingId] = useState<string>(saved[0]?.id ?? NEW);
  const current = saved.find((s) => s.id === editingId);
  const [name, setName] = useState(current?.name ?? "");
  const [draft, setDraft] = useState<string[]>(current?.nodeIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !current || current.name !== name || current.nodeIds.join("|") !== [...draft].sort().join("|");

  function choose(id: string) {
    const s = saved.find((x) => x.id === id);
    setEditingId(id);
    setName(s?.name ?? "");
    setDraft(s?.nodeIds ?? []);
    setError(null);
  }

  // The drawing previews the edit: other scopes as saved, this one as drafted.
  const preview = useMemo(() => {
    const others = saved.filter((s) => s.id !== editingId).map((s) => ({ id: s.id, name: s.name, nodeIds: s.nodeIds }));
    return draft.length ? [...others, { id: editingId === NEW ? "draft" : editingId, name: name || "New scope", nodeIds: draft }] : others;
  }, [saved, editingId, name, draft]);

  const request = useMemo(() => ({ sheet: "system" as const, rev: data.selectedId, scopes: preview }), [data.selectedId, preview]);

  function selectByClass(cls: string) {
    const ids = new Set<string>(draft);
    for (const e of Object.values(ctx.data.index.edges)) {
      if (e.dataClasses.some((t) => t.class === cls)) {
        ids.add(e.from);
        ids.add(e.to);
      }
    }
    for (const n of Object.values(ctx.data.index.nodes)) if (n.dataClasses.some((t) => t.class === cls)) ids.add(n.id);
    setDraft([...ids].sort());
  }

  async function save() {
    setError(null);
    if (!base) return setError(DEMO_NOTE);
    if (!name.trim()) return setError("Give the scope a name.");
    setBusy(true);
    const res = current
      ? await call("PUT", `${base}/scopes/${current.id}`, { name: name.trim(), nodeIds: draft })
      : await call("POST", `${base}/scopes`, { name: name.trim(), nodeIds: draft });
    setBusy(false);
    if (res.error) return setError(res.error);
    ctx.notify("Scope saved");
    if (!current && typeof res.body.id === "string") setEditingId(res.body.id);
    ctx.refresh();
  }

  async function remove() {
    if (!base || !current) return;
    setBusy(true);
    const res = await call("DELETE", `${base}/scopes/${current.id}`);
    setBusy(false);
    if (res.error) return setError(res.error);
    ctx.notify("Scope deleted");
    choose(saved.find((s) => s.id !== current.id)?.id ?? NEW);
    ctx.refresh();
  }

  return (
    <div className="ws-body with-inspector">
      <SheetViewer
        endpoint={endpoint}
        request={request}
        index={data.index}
        selection={selection}
        onSelect={onSelect}
        view="diagram"
        scopeEdit={{ active: true, draft, onChange: setDraft }}
        refreshKey={0}
      />
      <div className="stack">
        <section className="panel" aria-label="Scope editor">
          <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Scope</h2></div>
          <div className="panel-body stack">
            <Select label="Editing" value={editingId} onChange={(e) => choose(e.target.value)}>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value={NEW}>New scope</option>
            </Select>
            <Input label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Cardholder data environment" />
            <p aria-live="polite" className="muted"><strong data-testid="scope-count">{draft.length}</strong> element{draft.length === 1 ? "" : "s"} in scope</p>
            <ul className="evidence" aria-label="Elements in scope">
              {draft.map((id) => <li key={id}>{ctx.data.index.nodes[id]?.name ?? id}</li>)}
              {draft.length === 0 ? <li className="faint">Nothing selected. Click boxes on the sheet.</li> : null}
            </ul>
            <div className="row">
              <Button size="small" variant="quiet" onClick={() => selectByClass("PAN")}>Add everything carrying PAN</Button>
              <Button size="small" variant="quiet" onClick={() => setDraft([])}>Clear</Button>
            </div>
            {error ? <p className="error-text" role="alert">{error}</p> : null}
            <div className="row">
              <Button variant="primary" disabled={busy || !dirty || !data.permissions.canAdmin} onClick={save}>{busy ? "Saving" : "Save scope"}</Button>
              {current ? <Button variant="danger" disabled={busy || !data.permissions.canAdmin} onClick={remove}>Delete</Button> : null}
            </div>
            {!base ? <p className="hint">{DEMO_NOTE}</p> : !data.permissions.canAdmin ? <p className="hint">Only owners and admins can change scopes.</p> : null}
          </div>
        </section>
        <Inspector index={data.index} selection={selection} canDecide={data.permissions.canAdmin && Boolean(base)} onDecide={onDecide} onSelect={onSelect} />
      </div>
    </div>
  );
}
