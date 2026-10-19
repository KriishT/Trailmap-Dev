"use client";

import { useRef, useState } from "react";
import { Button, ClassStamp, Dialog, EmptyState, Input, Select, Stamp, Table, Td, Textarea, Th, Tr } from "@trailmap/ui";
import { call, DEMO_NOTE, fmtDate, fmtDateTime, type Ctx } from "./api";

/* ------------------------------------------------------------------ Vendors */

export function VendorsPanel({ ctx }: { ctx: Ctx }) {
  const { data, base } = ctx;
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ purpose: "", region: "", dpa: "unknown", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const row = data.vendors.find((v) => v.vendorId === editing);
  const exportBase = base ? `${base}/export` : "/api/demo/export";

  function edit(id: string) {
    const v = data.vendors.find((x) => x.vendorId === id)!;
    setForm({ purpose: v.purpose, region: v.region, dpa: v.dpaOnFile === null ? "unknown" : v.dpaOnFile ? "yes" : "no", notes: v.notes });
    setError(null);
    setEditing(id);
  }

  async function save() {
    if (!base) return setError(DEMO_NOTE);
    setBusy(true);
    const res = await call("PUT", `${base}/vendors/${encodeURIComponent(editing!)}`, {
      purpose: form.purpose, region: form.region, notes: form.notes, dpaOnFile: form.dpa === "unknown" ? null : form.dpa === "yes",
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setEditing(null);
    ctx.notify("Vendor record saved");
    ctx.refresh();
  }

  if (data.vendors.length === 0) {
    return <EmptyState title="No third-party vendors found">No SDK or API calls to outside services were detected in this revision. If you expect some, check that the repository includes the code that calls them, then scan again.</EmptyState>;
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Every outside service the code talks to, with the data classes that reach it and the code that proves it. Purpose, region and DPA status cannot be read from code, so you record them here.
        </p>
        <div className="row">
          <a className="btn btn-small" href={`${exportBase}?format=csv&framework=soc2`} download>Download CSV</a>
          <a className="btn btn-small btn-quiet" href={`${exportBase}?format=csv&framework=dora`} download>DORA register assist</a>
        </div>
      </div>
      <Table caption="Third-party vendors">
        <thead>
          <tr><Th>Vendor</Th><Th>Category</Th><Th>Used by</Th><Th>Data</Th><Th>Confidence</Th><Th>Purpose</Th><Th>Region</Th><Th>DPA</Th><Th>Evidence</Th><Th><span className="sr-only">Actions</span></Th></tr>
        </thead>
        <tbody>
          {data.vendors.map((v) => (
            <Tr key={v.vendorId}>
              <Td><strong>{v.name}</strong>{v.kind === "external" ? <div className="hint">not in catalog</div> : null}</Td>
              <Td>{v.category}</Td>
              <Td>{v.usedBy.map((u) => u.name).join(", ") || "None"}</Td>
              <Td><span className="row">{v.evidencedClasses.map((c) => <ClassStamp key={c} name={c} />)}{v.possibleClasses.map((c) => <ClassStamp key={c} name={c} possible />)}{v.evidencedClasses.length + v.possibleClasses.length === 0 ? <span className="faint">None</span> : null}</span></Td>
              <Td>{v.confidence}</Td>
              <Td>{v.purpose || <span className="faint">Not recorded</span>}</Td>
              <Td>{v.region || <span className="faint">Not recorded</span>}</Td>
              <Td>{v.dpaOnFile === null ? <span className="faint">Unknown</span> : v.dpaOnFile ? <Stamp tone="ok">On file</Stamp> : <Stamp tone="bad">Missing</Stamp>}</Td>
              <Td>
                <details>
                  <summary>{v.evidence.length} item{v.evidence.length === 1 ? "" : "s"}</summary>
                  <ul className="evidence">{v.evidence.map((e, i) => <li key={i}><code>{e.source}{e.line ? `:${e.line}` : ""}</code></li>)}</ul>
                </details>
              </Td>
              <Td><Button size="small" variant="quiet" onClick={() => edit(v.vendorId)} aria-label={`Edit ${v.name}`}>Edit</Button></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={row ? `Record details for ${row.name}` : "Vendor"} description="What the code cannot tell us. Saved for your whole organisation.">
        <div className="stack">
          <Input label="Purpose" value={form.purpose} maxLength={200} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
          <Input label="Data region" value={form.region} maxLength={60} onChange={(e) => setForm({ ...form, region: e.target.value })} hint="For example US, EU or Global." />
          <Select label="Data processing agreement" value={form.dpa} onChange={(e) => setForm({ ...form, dpa: e.target.value })}>
            <option value="unknown">Unknown</option><option value="yes">On file</option><option value="no">Missing</option>
          </Select>
          <Textarea label="Notes" value={form.notes} maxLength={500} onChange={(e) => setForm({ ...form, notes: e.target.value })} error={error} />
        </div>
        <div className="actions"><Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? "Saving" : "Save"}</Button></div>
      </Dialog>
    </div>
  );
}

/* ---------------------------------------------------------------- Revisions */

export function RevisionsPanel({ ctx }: { ctx: Ctx }) {
  const { data } = ctx;
  const [asOf, setAsOf] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const newestFirst = [...data.revisions].reverse();

  function travel() {
    if (!asOf) return setMsg("Choose a date first.");
    const end = new Date(`${asOf}T23:59:59.999Z`).getTime();
    const hit = [...data.revisions].filter((r) => new Date(r.scannedAt).getTime() <= end).pop();
    if (!hit) return setMsg(`No snapshot existed on ${asOf}. The first one is ${fmtDate(data.revisions[0]!.scannedAt)}.`);
    setMsg(null);
    ctx.openRevision(hit.id);
  }

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-body row" style={{ alignItems: "end" }}>
          <Input label="Show the architecture as of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} hint="Opens the snapshot that was in force on that date." />
          <Button onClick={travel}>Show</Button>
          {msg ? <span className="error-text" role="status">{msg}</span> : null}
        </div>
      </div>
      <ol className="timeline panel" style={{ padding: "0 14px" }} aria-label="Revisions, newest first">
        {newestFirst.map((r) => (
          <li key={r.id} aria-current={r.id === data.selectedId ? "true" : undefined}>
            <div className="rev">{r.label}</div>
            <div className="stack" style={{ gap: 4 }}>
              <div><strong>{r.summary}</strong> {r.id === data.selectedId ? <Stamp tone="ok">Viewing</Stamp> : null}</div>
              <div className="faint mono">{fmtDateTime(r.scannedAt)}{r.commitSha ? `, commit ${r.commitSha.slice(0, 12)}` : ""}</div>
              <div className="faint mono">{r.nodeCount} elements, {r.edgeCount} connections{r.graphHash ? `, hash ${r.graphHash.slice(0, 12)}` : ""}</div>
              {r.id !== data.selectedId ? <div><Button size="small" variant="quiet" onClick={() => ctx.openRevision(r.id)}>View {r.label}</Button></div> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------- Review queue */

export function ReviewPanel({ ctx }: { ctx: Ctx }) {
  const { data, base } = ctx;
  const [cursor, setCursor] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const open = data.drift.filter((d) => d.status === "open");
  const done = data.drift.filter((d) => d.status !== "open");
  const reviewed = data.attestations.some((a) => a.kind === "snapshot_review" && a.graphHash === data.graphHash);

  async function acknowledge(id: string) {
    if (!base) return ctx.notify(DEMO_NOTE, "bad");
    setBusy(id);
    const res = await call("POST", `${base}/drift/${id}/ack`, { note: note || undefined });
    setBusy(null);
    if (res.error) return ctx.notify(res.error, "bad");
    ctx.notify("Acknowledged. The pull request check is being re-run.");
    setNote("");
    ctx.refresh();
  }

  async function review() {
    if (!base) return ctx.notify(DEMO_NOTE, "bad");
    setBusy("review");
    const res = await call("POST", `${base}/attestations`, { snapshotId: data.selectedId, note: note || undefined });
    setBusy(null);
    if (res.error) return ctx.notify(res.error, "bad");
    ctx.notify("Review recorded against this exact graph");
    setNote("");
    ctx.refresh();
  }

  async function undo(id: string) {
    if (!base) return ctx.notify(DEMO_NOTE, "bad");
    const res = await call("DELETE", `${base}/overrides/${id}`);
    if (res.error) return ctx.notify(res.error, "bad");
    ctx.notify("Decision undone");
    ctx.refresh();
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    if (e.key === "j") setCursor((c) => Math.min(c + 1, open.length - 1));
    else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
    else if (e.key === "a" && open[cursor]) void acknowledge(open[cursor]!.id);
  };

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Snapshot review</h2></div>
        <div className="panel-body stack">
          {reviewed ? <p><Stamp tone="ok">Reviewed</Stamp> A named person has reviewed the architecture at this exact graph hash.</p> : <p className="muted">Nobody has reviewed this revision yet. A review is recorded with your name against the graph hash, and appears in the title block of every export.</p>}
          <Textarea label="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <div><Button variant="primary" disabled={busy === "review"} onClick={review}>{reviewed ? "Review again" : "Mark this revision reviewed"}</Button></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Pull requests that changed scope</h2><span className="hint">Keys: <kbd>j</kbd> <kbd>k</kbd> move, <kbd>a</kbd> acknowledge</span></div>
        <div className="panel-body">
          {open.length === 0 ? (
            <EmptyState title="Nothing waiting for review">When a pull request adds a vendor, exposes a datastore or moves data across a scope boundary, it appears here and as a check on the pull request.</EmptyState>
          ) : (
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }} ref={list} onKeyDown={onKey} tabIndex={0} aria-label="Open drift findings">
              {open.map((d, i) => (
                <li key={d.id} className={i === cursor ? "notice drift" : "notice"} aria-current={i === cursor ? "true" : undefined}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>Pull request #{d.prNumber}</strong>
                    <Stamp tone={d.conclusion === "failure" ? "bad" : "plain"}>{d.conclusion}</Stamp>
                  </div>
                  <p className="muted">{d.summary} <span className="mono">{d.headSha.slice(0, 7)}</span></p>
                  <div className="stack" style={{ margin: "10px 0" }}>
                    {d.findings.map((f) => (
                      <div key={f.key} className={`finding sev-${f.severity}`}>
                        <strong>{f.title}</strong> <Stamp>{f.rule.replace(/_/g, " ")}</Stamp>
                        <p className="muted">{f.detail}</p>
                      </div>
                    ))}
                  </div>
                  <Button disabled={busy === d.id} onClick={() => acknowledge(d.id)}>Acknowledge as accepted risk</Button>
                </li>
              ))}
            </ul>
          )}
          {done.length ? (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Resolved</h3>
              <ul className="evidence">
                {done.map((d) => <li key={d.id}>#{d.prNumber} acknowledged by {d.acknowledgedBy ?? "a reviewer"} on {fmtDate(d.createdAt)}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Decisions</h2></div>
        <div className="panel-body">
          {data.orphanedOverrides > 0 ? <p className="notice drift" style={{ marginBottom: 12 }}>{data.orphanedOverrides} decision{data.orphanedOverrides === 1 ? "" : "s"} refer to elements that no longer exist in this revision and were not applied.</p> : null}
          {data.overrides.length === 0 ? (
            <p className="muted">No manual decisions. When the scanner is wrong, select the box or line in a sheet and confirm, hide or reclassify it. The reason is kept.</p>
          ) : (
            <Table caption="Manual decisions">
              <thead><tr><Th>Decision</Th><Th>Reason</Th><Th>By</Th><Th>When</Th><Th><span className="sr-only">Undo</span></Th></tr></thead>
              <tbody>
                {data.overrides.map((o) => (
                  <Tr key={o.id}><Td>{o.summary}</Td><Td>{o.reason}</Td><Td>{o.actor}</Td><Td className="mono">{fmtDate(o.createdAt)}</Td><Td>{data.permissions.canAdmin ? <Button size="small" variant="quiet" onClick={() => undo(o.id)}>Undo</Button> : null}</Td></Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
