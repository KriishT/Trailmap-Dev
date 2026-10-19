"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ClassStamp, ErrorState, Loading, Table, Td, Th, Tr } from "@trailmap/ui";
import type { InspectorIndex } from "@/lib/workspace/inspect";
import type { SceneResponse } from "@/lib/workspace/scene";

export type Selection = { kind: "node" | "edge"; id: string } | null;

export interface SheetRequest {
  sheet: "system" | "data-flow" | "network";
  rev?: string;
  dataClass?: string;
  minConfidence?: string;
  scopes?: Array<{ id: string; name: string; nodeIds: string[] }>;
}

export interface ScopeEditState {
  active: boolean;
  draft: string[];
  onChange: (next: string[]) => void;
}

interface Props {
  endpoint: string;
  request: SheetRequest;
  index: InspectorIndex;
  selection: Selection;
  onSelect: (s: Selection) => void;
  scopeEdit?: ScopeEditState;
  /** Bump to force a re-fetch after the data behind the sheet changed. */
  refreshKey?: number;
  view: "diagram" | "list";
}

type Dir = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
const DIRS: Dir[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/** The nearest node in the direction of travel, so arrow keys walk the drawing the way it looks. */
function neighbour(from: Element, all: Element[], dir: Dir): Element | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: { el: Element; score: number } | null = null;
  for (const el of all) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - ax;
    const dy = r.top + r.height / 2 - ay;
    const along = dir === "ArrowRight" ? dx : dir === "ArrowLeft" ? -dx : dir === "ArrowDown" ? dy : -dy;
    if (along <= 4) continue;
    const across = dir === "ArrowRight" || dir === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2.2;
    if (!best || score < best.score) best = { el, score };
  }
  return best?.el ?? null;
}

const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || (el as SVGElement).getClientRects().length > 0;

export function SheetViewer({ endpoint, request, index, selection, onSelect, scopeEdit, refreshKey = 0, view }: Props) {
  const [scene, setScene] = useState<SceneResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [retry, setRetry] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, SceneResponse>());
  const [lasso, setLasso] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);

  const key = useMemo(() => JSON.stringify([endpoint, request, refreshKey]), [endpoint, request, refreshKey]);

  useEffect(() => {
    if (view !== "diagram") return;
    const cached = cache.current.get(key);
    if (cached && retry === 0) {
      setScene(cached);
      setLoading(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `The sheet could not be drawn (${res.status})`);
        cache.current.set(key, body as SceneResponse);
        setScene(body as SceneResponse);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError") setError(err instanceof Error ? err.message : "The sheet could not be drawn");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already covers endpoint and request
  }, [key, retry, view]);

  // Reflect selection and the scope draft onto the drawn SVG by id, without redrawing it.
  useEffect(() => {
    const root = frameRef.current;
    if (!root) return;
    const draft = new Set(scopeEdit?.active ? scopeEdit.draft : []);
    root.querySelectorAll<SVGGElement>("[data-node-id]").forEach((el) => {
      const id = el.getAttribute("data-node-id")!;
      el.classList.toggle("is-picked", selection?.kind === "node" && selection.id === id);
      el.classList.toggle("is-in-draft", draft.has(id));
      if (scopeEdit?.active) el.setAttribute("aria-pressed", String(draft.has(id)));
      else el.removeAttribute("aria-pressed");
    });
    root.querySelectorAll<SVGGElement>("[data-edge-id]").forEach((el) => {
      el.classList.toggle("is-picked", selection?.kind === "edge" && selection.id === el.getAttribute("data-edge-id"));
    });
  }, [scene, selection, scopeEdit?.active, scopeEdit?.draft]);

  const activate = useCallback(
    (el: Element, additive: boolean) => {
      const nodeId = el.getAttribute("data-node-id");
      const edgeId = el.getAttribute("data-edge-id");
      if (scopeEdit?.active && nodeId) {
        const set = new Set(scopeEdit.draft);
        if (additive) set.add(nodeId);
        else if (set.has(nodeId)) set.delete(nodeId);
        else set.add(nodeId);
        scopeEdit.onChange([...set].sort());
        onSelect({ kind: "node", id: nodeId });
        return;
      }
      if (nodeId) onSelect({ kind: "node", id: nodeId });
      else if (edgeId) onSelect({ kind: "edge", id: edgeId });
    },
    [scopeEdit, onSelect]
  );

  const onClick = (e: React.MouseEvent) => {
    const hit = (e.target as Element).closest("[data-node-id], [data-edge-id]");
    if (hit) activate(hit, e.shiftKey);
    else if (!lassoStart.current) onSelect(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const hit = (e.target as Element).closest?.("[data-node-id], [data-edge-id]");
    if (e.key === "Escape") {
      onSelect(null);
      return;
    }
    if (!hit) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(hit, e.shiftKey);
      return;
    }
    if (DIRS.includes(e.key as Dir)) {
      const pool = [...(frameRef.current?.querySelectorAll("[data-node-id]") ?? [])].filter(visible);
      const from = hit.hasAttribute("data-node-id") ? hit : (pool[0] ?? hit);
      const next = neighbour(from, pool, e.key as Dir);
      if (next) {
        e.preventDefault();
        (next as SVGElement).focus();
      }
    }
  };

  // Lasso: drag on empty paper in scope-edit mode to add every node the rectangle touches.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!scopeEdit?.active || e.button !== 0) return;
    if ((e.target as Element).closest("[data-node-id], [data-edge-id], button")) return;
    const frame = frameRef.current!.getBoundingClientRect();
    lassoStart.current = { x: e.clientX - frame.left, y: e.clientY - frame.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = lassoStart.current;
    if (!s) return;
    const frame = frameRef.current!.getBoundingClientRect();
    const x = e.clientX - frame.left;
    const y = e.clientY - frame.top;
    setLasso({ x: Math.min(s.x, x), y: Math.min(s.y, y), w: Math.abs(x - s.x), h: Math.abs(y - s.y) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = lassoStart.current;
    lassoStart.current = null;
    if (!s || !scopeEdit) return setLasso(null);
    const frame = frameRef.current!.getBoundingClientRect();
    const x2 = e.clientX - frame.left;
    const y2 = e.clientY - frame.top;
    const box = { l: Math.min(s.x, x2) + frame.left, r: Math.max(s.x, x2) + frame.left, t: Math.min(s.y, y2) + frame.top, b: Math.max(s.y, y2) + frame.top };
    setLasso(null);
    if (box.r - box.l < 6 && box.b - box.t < 6) return;
    const set = new Set(scopeEdit.draft);
    frameRef.current!.querySelectorAll("[data-node-id]").forEach((el) => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.left < box.r && r.right > box.l && r.top < box.b && r.bottom > box.t) set.add(el.getAttribute("data-node-id")!);
    });
    scopeEdit.onChange([...set].sort());
  };

  if (view === "list") return <ListView index={index} selection={selection} onSelect={onSelect} />;

  return (
    <div>
      <div className="row no-print" style={{ marginBottom: 8, justifyContent: "space-between" }}>
        <span className="hint">
          {scopeEdit?.active
            ? "Scope editing: click a box to add or remove it, Shift+click to add, or drag across empty paper to select a group."
            : "Select a box or line to see the code behind it. Arrow keys move between boxes; Enter selects."}
        </span>
        <span className="row" role="group" aria-label="Zoom">
          <Button size="small" variant="quiet" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}>-</Button>
          <span className="mono hint" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <Button size="small" variant="quiet" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}>+</Button>
          <Button size="small" variant="quiet" onClick={() => setZoom(1)}>Reset</Button>
        </span>
      </div>
      {error ? (
        <ErrorState title="This sheet could not be drawn" action={<Button onClick={() => setRetry((n) => n + 1)}>Try again</Button>}>{error}</ErrorState>
      ) : (
        <div
          className="sheet-frame"
          ref={frameRef}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ touchAction: scopeEdit?.active ? "none" : undefined }}
        >
          {loading && !scene ? <Loading label="Drawing the sheet" height={320} /> : null}
          {scene ? (
            <div className="sheet-scroll" style={{ opacity: loading ? 0.6 : 1 }} data-testid="sheet" data-node-count={scene.nodeCount} data-edge-count={scene.edgeCount}>
              <div style={{ width: `${zoom * 100}%` }}>
                <div className="theme-light-only" dangerouslySetInnerHTML={{ __html: scene.svg.light }} />
                <div className="theme-dark-only" dangerouslySetInnerHTML={{ __html: scene.svg.dark }} />
              </div>
            </div>
          ) : null}
          {lasso ? <div className="lasso" style={{ left: lasso.x, top: lasso.y, width: lasso.w, height: lasso.h }} aria-hidden="true" /> : null}
        </div>
      )}
    </div>
  );
}

/** The same sheet as plain tables: the accessible alternative to the drawing, and handy for long lists. */
function ListView({ index, selection, onSelect }: { index: InspectorIndex; selection: Selection; onSelect: (s: Selection) => void }) {
  const nodes = Object.values(index.nodes).sort((a, b) => a.name.localeCompare(b.name));
  const edges = Object.values(index.edges).sort((a, b) => a.fromName.localeCompare(b.fromName) || a.toName.localeCompare(b.toName));
  return (
    <div className="stack">
      <Table caption="Nodes">
        <thead><tr><Th>Name</Th><Th>Type</Th><Th>Path</Th><Th>Data</Th><Th>Exposure</Th></tr></thead>
        <tbody>
          {nodes.map((n) => (
            <Tr key={n.id} selected={selection?.kind === "node" && selection.id === n.id}>
              <Td><button className="btn btn-small btn-quiet" onClick={() => onSelect({ kind: "node", id: n.id })} aria-label={`Inspect ${n.name}`}>{n.name}</button></Td>
              <Td>{n.type}{n.engine ? ` (${n.engine})` : ""}</Td>
              <Td className="mono">{n.path || "none"}</Td>
              <Td><span className="row">{n.dataClasses.map((t) => <ClassStamp key={t.class} name={t.class} possible={t.certainty === "possible"} />)}</span></Td>
              <Td>{n.public ? "Public" : "Internal"}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Table caption="Connections">
        <thead><tr><Th>From</Th><Th>To</Th><Th>Type</Th><Th>Confidence</Th><Th>Data</Th></tr></thead>
        <tbody>
          {edges.map((e) => (
            <Tr key={e.id} selected={selection?.kind === "edge" && selection.id === e.id}>
              <Td>{e.fromName}</Td>
              <Td><button className="btn btn-small btn-quiet" onClick={() => onSelect({ kind: "edge", id: e.id })} aria-label={`Inspect connection from ${e.fromName} to ${e.toName}`}>{e.toName}</button></Td>
              <Td>{e.type}</Td>
              <Td>{e.confidence}</Td>
              <Td><span className="row">{e.dataClasses.map((t) => <ClassStamp key={t.class} name={t.class} possible={t.certainty === "possible"} />)}</span></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
