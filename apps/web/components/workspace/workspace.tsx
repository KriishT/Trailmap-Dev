"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, CommandPalette, EmptyState, Select, Stamp, TabPanel, Tabs, type Command, type TabSpec } from "@trailmap/ui";
import type { ClientWorkspace } from "@/lib/workspace/client-data";
import { ThemeToggle, setTheme } from "@/components/theme-toggle";
import { call, DEMO_NOTE, fmtDate, type Ctx } from "./api";
import { Inspector, type Decision } from "./inspector";
import { ReviewPanel, RevisionsPanel, VendorsPanel } from "./panels-data";
import { ExportPanel, SettingsPanel, SharePanel } from "./panels-output";
import { ScopesTab } from "./scope-editor";
import { SheetViewer, type Selection } from "./sheet-viewer";

type SheetTab = "system" | "data-flow" | "network";
const SHEET_TABS: SheetTab[] = ["system", "data-flow", "network"];

/** The evidence workspace: three sheets, vendor inventory, revisions, review queue, scopes, export and sharing. */
export function Workspace({ data, initialTab }: { data: ClientWorkspace; initialTab: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTabState] = useState(initialTab);
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<"diagram" | "list">("diagram");
  const [dataClass, setDataClass] = useState("");
  const [minConfidence, setMinConfidence] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "bad" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const base = data.demo ? null : `/api/repos/${data.repo.id}`;
  const endpoint = data.demo ? "/api/demo/scene" : `${base}/scene`;

  const setTab = useCallback((id: string) => {
    setTabState(id);
    setSelection(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  }, []);

  const notify = useCallback((message: string, tone: "ok" | "bad" = "ok") => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const openRevision = useCallback((id: string) => {
    router.push(`${pathname}?rev=${encodeURIComponent(id)}&tab=${tab}`);
  }, [router, pathname, tab]);

  const ctx: Ctx = useMemo(() => ({ data, base, refresh: () => router.refresh(), notify, openRevision }), [data, base, router, notify, openRevision]);

  async function decide(decision: Decision, reason: string): Promise<string | null> {
    if (!base) return DEMO_NOTE;
    const res = await call("POST", `${base}/overrides`, { ...decision, reason });
    if (res.error) return res.error;
    notify("Decision recorded. The sheets are redrawn with it applied.");
    router.refresh();
    return null;
  }

  const openDrift = data.drift.filter((d) => d.status === "open").length;
  const tabs: TabSpec[] = [
    { id: "system", label: "System" },
    { id: "data-flow", label: "Data flow" },
    { id: "network", label: "Network" },
    { id: "vendors", label: "Vendors", badge: undefined },
    { id: "revisions", label: "Revisions" },
    { id: "review", label: "Review", badge: openDrift || undefined },
    { id: "scopes", label: "Scopes" },
    { id: "export", label: "Export" },
    { id: "share", label: "Share" },
    { id: "settings", label: "Settings" },
  ];

  const commands: Command[] = useMemo(() => {
    const list: Command[] = tabs.map((t) => ({ id: `tab-${t.id}`, label: `Go to ${t.label}`, hint: "sheet", run: () => setTab(t.id) }));
    list.push({ id: "theme-light", label: "Use drafting paper theme", run: () => setTheme("light") });
    list.push({ id: "theme-dark", label: "Use blueprint theme", run: () => setTheme("dark") });
    list.push({ id: "export-pdf", label: "Export PDF evidence pack", hint: "export", run: () => setTab("export") });
    for (const r of [...data.revisions].reverse()) list.push({ id: `rev-${r.id}`, label: `Open ${r.label}: ${r.summary}`, hint: fmtDate(r.scannedAt), run: () => openRevision(r.id) });
    for (const n of Object.values(data.index.nodes)) {
      list.push({ id: `node-${n.id}`, label: `Find ${n.name}`, hint: n.type, run: () => { if (!SHEET_TABS.includes(tab as SheetTab)) setTab("system"); setSelection({ kind: "node", id: n.id }); } });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabs is derived from openDrift only
  }, [data.revisions, data.index.nodes, openDrift, tab, setTab, openRevision]);

  const rev = data.revisions.find((r) => r.id === data.selectedId);
  const reviewer = data.attestations.find((a) => a.kind === "snapshot_review" && a.graphHash === data.graphHash);
  const sheetRequest = useMemo(
    () => ({ sheet: (SHEET_TABS.includes(tab as SheetTab) ? tab : "system") as SheetTab, rev: data.selectedId, ...(dataClass && tab === "data-flow" ? { dataClass } : {}), ...(minConfidence ? { minConfidence } : {}) }),
    [tab, data.selectedId, dataClass, minConfidence]
  );
  const driftNodes = data.highlightNodeIds.length;

  return (
    <div>
      <div className="wrap">
        <div className="ws-top">
          <div>
            <h1>{data.repo.fullName}</h1>
            <p className="muted" style={{ marginTop: 2 }}>
              {rev?.label} <span aria-hidden>·</span> {fmtDate(rev?.scannedAt ?? data.scannedAt)}
              {rev?.commitSha ? <> <span aria-hidden>·</span> <span className="mono">{rev.commitSha.slice(0, 7)}</span></> : null}
              {" "}<span aria-hidden>·</span> <span className="mono" title={data.graphHash ?? ""}>hash {data.graphHash?.slice(0, 10) ?? "none"}</span>
            </p>
          </div>
          <div className="row" style={{ marginLeft: "auto" }}>
            {data.demo ? <Stamp>Sample data</Stamp> : null}
            {reviewer ? <Stamp tone="ok" title={`Reviewed by ${reviewer.actor}`}>Reviewed</Stamp> : <Stamp possible>Not reviewed</Stamp>}
            {driftNodes ? <span className="hl" title="Elements added or changed since the previous revision">{driftNodes} changed</span> : null}
            {data.activeScan ? <Stamp tone="plain">Scan {data.activeScan.status}</Stamp> : null}
            <Select label="Revision" value={data.selectedId} onChange={(e) => openRevision(e.target.value)}>
              {[...data.revisions].reverse().map((r) => <option key={r.id} value={r.id}>{r.label}, {fmtDate(r.scannedAt)}</option>)}
            </Select>
            <Button size="small" variant="quiet" onClick={() => setPaletteOpen(true)}>Search <kbd>Ctrl K</kbd></Button>
            <ThemeToggle />
          </div>
        </div>
        <Tabs tabs={tabs} active={tab} onChange={setTab} label="Workspace sections" idPrefix="ws" />
        <div role="status" aria-live="polite" style={{ minHeight: 0 }}>
          {toast ? <div className={toast.tone === "bad" ? "notice drift" : "notice"} style={{ marginTop: 12 }}>{toast.message}</div> : null}
        </div>

        <div style={{ paddingTop: 16, paddingBottom: 64 }}>
          {SHEET_TABS.map((s) => (
            <TabPanel key={s} id={s} active={tab} idPrefix="ws">
              {s === "network" && !data.hasNetworkSheet ? (
                <EmptyState title="No network sheet for this repository">No Terraform, CloudFormation, Kubernetes or Helm files were found, so there are no security groups, load balancers or ingress rules to draw. Add infrastructure code to the repository and scan again.</EmptyState>
              ) : (
                <>
                  <div className="sheet-toolbar no-print">
                    <div className="field">
                      <label htmlFor="view-mode">Show as</label>
                      <select id="view-mode" className="select" value={view} onChange={(e) => setView(e.target.value as "diagram" | "list")}>
                        <option value="diagram">Diagram</option><option value="list">List</option>
                      </select>
                    </div>
                    {s === "data-flow" ? (
                      <div className="field">
                        <label htmlFor="class-filter">Data class</label>
                        <select id="class-filter" className="select" value={dataClass} onChange={(e) => setDataClass(e.target.value)}>
                          <option value="">All classes</option><option value="PAN">PAN</option><option value="PII">PII</option><option value="PHI">PHI</option><option value="CREDENTIALS">CREDENTIALS</option>
                        </select>
                      </div>
                    ) : null}
                    <div className="field">
                      <label htmlFor="conf-filter">Show connections with</label>
                      <select id="conf-filter" className="select" value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)}>
                        <option value="">Any confidence</option><option value="medium">Medium or high</option><option value="high">High only</option>
                      </select>
                    </div>
                  </div>
                  <div className="ws-body with-inspector" style={{ paddingTop: 0 }}>
                    <SheetViewer endpoint={endpoint} request={sheetRequest} index={data.index} selection={selection} onSelect={setSelection} view={view} />
                    <Inspector index={data.index} selection={selection} canDecide={data.permissions.canAdmin && Boolean(base)} onDecide={decide} onSelect={setSelection} />
                  </div>
                </>
              )}
            </TabPanel>
          ))}
          <TabPanel id="vendors" active={tab} idPrefix="ws"><VendorsPanel ctx={ctx} /></TabPanel>
          <TabPanel id="revisions" active={tab} idPrefix="ws"><RevisionsPanel ctx={ctx} /></TabPanel>
          <TabPanel id="review" active={tab} idPrefix="ws"><ReviewPanel ctx={ctx} /></TabPanel>
          <TabPanel id="scopes" active={tab} idPrefix="ws"><ScopesTab ctx={ctx} endpoint={endpoint} selection={selection} onSelect={setSelection} onDecide={decide} /></TabPanel>
          <TabPanel id="export" active={tab} idPrefix="ws"><ExportPanel ctx={ctx} /></TabPanel>
          <TabPanel id="share" active={tab} idPrefix="ws"><SharePanel ctx={ctx} /></TabPanel>
          <TabPanel id="settings" active={tab} idPrefix="ws"><SettingsPanel ctx={ctx} /></TabPanel>
        </div>
      </div>
      <CommandPalette commands={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
