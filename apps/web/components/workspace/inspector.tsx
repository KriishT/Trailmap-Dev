"use client";

import { useState } from "react";
import { Button, ClassStamp, Dialog, Stamp, Textarea } from "@trailmap/ui";
import type { EdgeView, InspectorIndex, NodeView, TagView } from "@/lib/workspace/inspect";
import type { Selection } from "./sheet-viewer";

export type Decision = Record<string, unknown>;

interface Props {
  index: InspectorIndex;
  selection: Selection;
  canDecide: boolean;
  /** Records a decision with a reason. Resolves to an error message, or null when it was saved. */
  onDecide: (decision: Decision, reason: string) => Promise<string | null>;
  onSelect: (s: Selection) => void;
}

function Evidence({ items }: { items: Array<{ kind: string; source: string; line?: number | null; snippet?: string; detail: string }> }) {
  if (items.length === 0) return <p className="hint">No code evidence is recorded for this. It comes from configuration or a manual decision.</p>;
  return (
    <ol className="evidence" aria-label="Evidence">
      {items.map((ev, i) => (
        <li key={`${ev.source}:${ev.line ?? 0}:${i}`}>
          <div><span className="stamp stamp-plain">{ev.kind}</span> <code>{ev.source}{ev.line ? `:${ev.line}` : ""}</code></div>
          <div className="muted">{ev.detail}</div>
          {ev.snippet ? <code className="faint">{ev.snippet}</code> : null}
        </li>
      ))}
    </ol>
  );
}

function Classes({ tags }: { tags: TagView[] }) {
  if (tags.length === 0) return <span className="faint">None recorded</span>;
  return <span className="row">{tags.map((t) => <ClassStamp key={t.class} name={t.class} possible={t.certainty === "possible"} />)}</span>;
}

function NodePanel({ node, onSelect, ask }: { node: NodeView; onSelect: Props["onSelect"]; ask: (label: string, d: Decision) => void }) {
  return (
    <div className="stack">
      <div>
        <h3>{node.name}</h3>
        <p className="muted">{node.type}{node.engine ? `, ${node.engine}` : ""}{node.framework ? `, ${node.framework}` : ""}</p>
      </div>
      <dl className="kv">
        <dt>Id</dt><dd className="mono">{node.id}</dd>
        {node.path ? <><dt>Path</dt><dd className="mono">{node.path}</dd></> : null}
        <dt>Language</dt><dd>{node.language}</dd>
        {node.port ? <><dt>Port</dt><dd className="mono">{node.port}</dd></> : null}
        <dt>Exposure</dt><dd>{node.public ? <Stamp tone="bad">Public</Stamp> : "Internal"}</dd>
        {node.scopes.length ? <><dt>Scope</dt><dd>{node.scopes.join(", ")}</dd></> : null}
        <dt>Data</dt><dd><Classes tags={node.dataClasses} /></dd>
      </dl>
      {node.exposure.length ? (
        <div>
          <h4>Network rules</h4>
          <ul className="evidence">
            {node.exposure.map((x, i) => (
              <li key={i}>{x.direction} {x.cidr}{x.port ? `:${x.port}` : ""} <span className="faint mono">{x.source}{x.line ? `:${x.line}` : ""}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h4>Connections</h4>
        <ul className="evidence">
          {node.outbound.map((l) => (
            <li key={l.edgeId}><button className="btn btn-small btn-quiet" onClick={() => onSelect({ kind: "edge", id: l.edgeId })}>to {l.otherName}</button> {l.type}, {l.confidence}</li>
          ))}
          {node.inbound.map((l) => (
            <li key={l.edgeId}><button className="btn btn-small btn-quiet" onClick={() => onSelect({ kind: "edge", id: l.edgeId })}>from {l.otherName}</button> {l.type}, {l.confidence}</li>
          ))}
          {node.inbound.length + node.outbound.length === 0 ? <li className="faint">No connections</li> : null}
        </ul>
      </div>
      <div>
        <h4>Evidence</h4>
        <Evidence items={node.evidence} />
      </div>
      <div className="row no-print">
        <Button size="small" variant="quiet" disabled={!node.id} onClick={() => ask(`Hide ${node.name}`, { kind: "hide_node", nodeId: node.id })}>Hide this node</Button>
      </div>
    </div>
  );
}

const CLASSES = ["PII", "PAN", "PHI", "CREDENTIALS"] as const;

function EdgePanel({ edge, ask, onSelect }: { edge: EdgeView; ask: (label: string, d: Decision) => void; onSelect: Props["onSelect"] }) {
  return (
    <div className="stack">
      <div>
        <h3>{edge.fromName} to {edge.toName}</h3>
        <p className="muted">{edge.type} connection, {edge.confidence} confidence</p>
      </div>
      <dl className="kv">
        <dt>From</dt><dd><button className="btn btn-small btn-quiet" onClick={() => onSelect({ kind: "node", id: edge.from })}>{edge.fromName}</button></dd>
        <dt>To</dt><dd><button className="btn btn-small btn-quiet" onClick={() => onSelect({ kind: "node", id: edge.to })}>{edge.toName}</button></dd>
        <dt>Data</dt><dd><Classes tags={edge.dataClasses} /></dd>
      </dl>
      <div>
        <h4>Evidence</h4>
        <Evidence items={edge.evidence} />
      </div>
      {edge.dataClasses.filter((t) => t.certainty === "evidenced").map((t) => (
        <div key={t.class}>
          <h4>Why {t.class}</h4>
          <Evidence items={t.evidence} />
        </div>
      ))}
      <div className="row no-print">
        <Button size="small" variant="quiet" onClick={() => ask("Confirm this connection", { kind: "confirm_edge", edgeId: edge.id })}>Confirm</Button>
        <Button size="small" variant="quiet" onClick={() => ask("Hide this connection", { kind: "hide_edge", edgeId: edge.id })}>Hide</Button>
        {CLASSES.filter((c) => !edge.dataClasses.some((t) => t.class === c && t.certainty === "evidenced")).map((c) => (
          <Button key={c} size="small" variant="quiet" onClick={() => ask(`Mark ${c} on this connection`, { kind: "set_data_class", target: { kind: "edge", id: edge.id }, class: c, present: true })}>Mark {c}</Button>
        ))}
      </div>
    </div>
  );
}

/** Detail for the selected box or line: what it is, what proves it, and the decisions a reviewer can record. */
export function Inspector({ index, selection, canDecide, onDecide, onSelect }: Props) {
  const [pending, setPending] = useState<{ label: string; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const node = selection?.kind === "node" ? index.nodes[selection.id] : undefined;
  const edge = selection?.kind === "edge" ? index.edges[selection.id] : undefined;
  const ask = (label: string, decision: Decision) => {
    if (!canDecide) return;
    setPending({ label, decision });
    setReason("");
    setError(null);
  };

  async function submit() {
    if (!pending) return;
    if (!reason.trim()) return setError("A reason is required. It is recorded with the decision.");
    setBusy(true);
    const err = await onDecide(pending.decision, reason.trim());
    setBusy(false);
    if (err) setError(err);
    else setPending(null);
  }

  return (
    <aside className="panel" aria-label="Inspector" data-testid="inspector">
      <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Inspector</h2></div>
      <div className="panel-body">
        {!selection || (!node && !edge) ? (
          <p className="muted">Select a box or a line on the sheet. You will see what it is and the lines of code that show it.</p>
        ) : node ? (
          <NodePanel node={node} onSelect={onSelect} ask={canDecide ? ask : () => undefined} />
        ) : edge ? (
          <EdgePanel edge={edge} onSelect={onSelect} ask={canDecide ? ask : () => undefined} />
        ) : null}
        {!canDecide && (node || edge) ? <p className="hint" style={{ marginTop: 12 }}>Only organisation owners and admins can record decisions.</p> : null}
      </div>
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)} title={pending?.label ?? ""} description="Decisions are recorded with your name and reason, apply to later scans, and can be undone.">
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={error} maxLength={500} />
        <div className="actions">
          <Button variant="quiet" onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>{busy ? "Saving" : "Record decision"}</Button>
        </div>
      </Dialog>
    </aside>
  );
}
