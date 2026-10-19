"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, EmptyState, Input, Select, Stamp, Table, Td, Th, TitleBlock, Tr } from "@trailmap/ui";
import { call, fmtDate, fmtDateTime, type Ctx } from "./api";

const FORMATS = [
  { id: "pdf", label: "PDF evidence pack (all sheets, vendors, revisions)" },
  { id: "pack", label: "Zip: PDF, SVG sheets, JSON, CSV and a hash manifest" },
  { id: "svg", label: "SVG of one sheet" },
  { id: "json", label: "JSON graph with evidence" },
  { id: "csv", label: "CSV vendor inventory" },
] as const;

/* ------------------------------------------------------------------- Export */

export function ExportPanel({ ctx }: { ctx: Ctx }) {
  const { data, base } = ctx;
  const [framework, setFramework] = useState(data.policy.frameworks[0] ?? "pci-dss");
  const [format, setFormat] = useState<string>("pdf");
  const [sheet, setSheet] = useState("system");
  const [theme, setTheme] = useState("light");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; fileHash: string; graphHash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rev = data.revisions.find((r) => r.id === data.selectedId);
  const fw = data.frameworks.find((f) => f.id === framework);

  async function download() {
    setBusy(true);
    setError(null);
    setResult(null);
    const q = new URLSearchParams({ format, framework, sheet, theme, rev: data.selectedId });
    if (start || end) {
      q.set("periodStart", start);
      q.set("periodEnd", end);
    }
    try {
      const res = await fetch(`${base ? `${base}/export` : "/api/demo/export"}?${q}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `The export failed (${res.status})`);
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `trailmap-export.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setResult({ name, fileHash: res.headers.get("x-trailmap-file-hash") ?? "", graphHash: res.headers.get("x-trailmap-graph-hash") ?? "" });
      ctx.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        <div className="panel">
          <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Auditor export</h2></div>
          <div className="panel-body stack">
            <Select label="Framework" value={framework} onChange={(e) => setFramework(e.target.value)} hint="Selects which requirement notes and sheets the pack includes.">
              {data.frameworks.map((f) => <option key={f.id} value={f.id}>{f.name} {f.version}</option>)}
            </Select>
            <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
            {format === "svg" ? (
              <Select label="Sheet" value={sheet} onChange={(e) => setSheet(e.target.value)}>
                <option value="system">System architecture</option><option value="data-flow">Data flow</option><option value="network">Network and exposure</option>
              </Select>
            ) : null}
            <Select label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="light">Drafting paper (prints well)</option><option value="dark">Blueprint</option>
            </Select>
            <div className="row" style={{ alignItems: "end" }}>
              <Input label="Audit period from" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <Input label="to" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="row">
              <Button variant="primary" disabled={busy} onClick={download}>{busy ? "Preparing" : "Download"}</Button>
              {base ? null : <span className="hint">Sample data: the file is real, but nothing is recorded.</span>}
            </div>
            {error ? <p className="error-text" role="alert">{error}</p> : null}
            {result ? (
              <div className="notice" role="status">
                <strong>{result.name}</strong> downloaded.
                <dl className="kv" style={{ marginTop: 6 }}><dt>File hash</dt><dd className="mono">{result.fileHash}</dd><dt>Graph hash</dt><dd className="mono">{result.graphHash}</dd></dl>
              </div>
            ) : null}
          </div>
        </div>
        {fw ? <p className="hint" style={{ maxWidth: "62ch" }}>The pack maps what the code shows to the requirement text of {fw.name} {fw.version} and says what a person must still verify. It supports an assessment; it is not a certification and does not claim compliance.</p> : null}
      </div>

      <div className="stack">
        <TitleBlock
          title="Export preview: title block"
          rows={[
            { label: "Repository", value: data.repo.fullName },
            { label: "Revision", value: rev?.label ?? "current" },
            { label: "Commit", value: rev?.commitSha ? rev.commitSha.slice(0, 12) : "not recorded" },
            { label: "Date", value: fmtDate(rev?.scannedAt ?? data.scannedAt) },
            { label: "Framework", value: fw ? `${fw.name} ${fw.version}` : framework },
            { label: "Period", value: start && end ? `${start} to ${end}` : "not stated" },
            { label: "Reviewed", value: data.attestations.find((a) => a.kind === "snapshot_review" && a.graphHash === data.graphHash)?.actor ?? "not reviewed" },
            { label: "Graph hash", value: data.graphHash ?? "not recorded" },
          ]}
        />
        {base ? (
          <div className="panel">
            <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Past exports</h2></div>
            <div className="panel-body">
              {data.exports.length === 0 ? <p className="muted">Nothing exported yet. Each download is recorded with the hash of the file, so a copy in an auditor&apos;s hands can be matched to this record.</p> : (
                <Table caption="Past exports">
                  <thead><tr><Th>When</Th><Th>Framework</Th><Th>Format</Th><Th>File hash</Th></tr></thead>
                  <tbody>{data.exports.slice(0, 10).map((x) => <Tr key={x.id}><Td className="mono">{fmtDate(x.createdAt)}</Td><Td>{x.framework}</Td><Td>{x.format}</Td><Td className="mono">{x.fileHash.slice(0, 16)}</Td></Tr>)}</tbody>
                </Table>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- Share */

interface AccessEntry { accessed_at: string; outcome: string; ip_hash: string | null; user_agent: string | null }

export function SharePanel({ ctx }: { ctx: Ctx }) {
  const { data, base } = ctx;
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ slug: string; entries: AccessEntry[] } | null>(null);

  if (!base) {
    return <EmptyState title="Share links need a saved repository">The sample workspace is public already. Connect a repository to create password-protected, expiring links for auditors.</EmptyState>;
  }

  async function create() {
    setBusy(true);
    setError(null);
    setCreated(null);
    const res = await call("POST", "/api/maps/share", {
      snapshotId: data.selectedId, label: label || undefined, password: password || undefined, expiresInDays: days ? Number(days) : null,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setCreated(`${window.location.origin}/map/${res.body.slug as string}`);
    setPassword("");
    ctx.refresh();
  }

  async function revoke(slug: string) {
    const res = await call("POST", `/api/maps/${slug}/revoke`);
    if (res.error) return ctx.notify(res.error, "bad");
    ctx.notify("Link revoked. It stops working immediately.");
    ctx.refresh();
  }

  async function openLog(slug: string) {
    const res = await call("GET", `/api/maps/${slug}/access-log`);
    if (res.error) return ctx.notify(res.error, "bad");
    setLog({ slug, entries: (res.body.entries as AccessEntry[]) ?? [] });
  }

  const now = Date.now();
  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>New read-only link</h2></div>
        <div className="panel-body stack">
          <p className="muted">Shares the sheets of the revision you are viewing ({data.revisions.find((r) => r.id === data.selectedId)?.label}). Recipients cannot see anything else, and every visit is logged.</p>
          <Input label="Recipient label (shown as a watermark)" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} hint="For example: Acme Assessors, Q3 audit." />
          <Input label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters. Leave empty for a link anyone can open." />
          <Select label="Expires" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option><option value="">Never</option>
          </Select>
          <div><Button variant="primary" disabled={busy} onClick={create}>{busy ? "Creating" : "Create link"}</Button></div>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {created ? <div className="notice" role="status">Link created: <a href={created} className="mono">{created}</a></div> : null}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Links for this repository</h2></div>
        <div className="panel-body">
          {data.shares.length === 0 ? <p className="muted">No links yet.</p> : (
            <Table caption="Share links">
              <thead><tr><Th>Link</Th><Th>Status</Th><Th>Expires</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {data.shares.map((s) => {
                  const expired = s.expiresAt !== null && new Date(s.expiresAt).getTime() < now;
                  return (
                    <Tr key={s.slug}>
                      <Td><a href={`/map/${s.slug}`} className="mono">{s.slug.slice(0, 8)}</a>{s.label ? <div className="hint">{s.label}</div> : null}</Td>
                      <Td>{s.revokedAt ? <Stamp tone="bad">Revoked</Stamp> : expired ? <Stamp tone="plain">Expired</Stamp> : <Stamp tone="ok">Active</Stamp>}</Td>
                      <Td className="mono">{s.expiresAt ? fmtDate(s.expiresAt) : "Never"}</Td>
                      <Td><span className="row"><Button size="small" variant="quiet" onClick={() => openLog(s.slug)}>Access log</Button>{!s.revokedAt ? <Button size="small" variant="danger" onClick={() => revoke(s.slug)}>Revoke</Button> : null}</span></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      </div>
      <Dialog open={log !== null} onOpenChange={(o) => !o && setLog(null)} title="Access log" description="Visitors are recorded by a hash of their address, not the address itself.">
        {log && log.entries.length === 0 ? <p className="muted">Nobody has opened this link.</p> : (
          <Table caption="Access log">
            <thead><tr><Th>When</Th><Th>Outcome</Th><Th>Client</Th></tr></thead>
            <tbody>{log?.entries.map((e, i) => <Tr key={i}><Td className="mono">{fmtDateTime(e.accessed_at)}</Td><Td>{e.outcome}</Td><Td>{(e.user_agent ?? "unknown").slice(0, 40)}</Td></Tr>)}</tbody>
          </Table>
        )}
      </Dialog>
    </div>
  );
}

/* ----------------------------------------------------------------- Settings */

interface KeyRow { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

export function SettingsPanel({ ctx }: { ctx: Ctx }) {
  const { data, base } = ctx;
  const [frameworks, setFrameworks] = useState<string[]>(data.policy.frameworks);
  const [onDrift, setOnDrift] = useState(data.policy.onDrift);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orgId = data.repo.orgId;
  useEffect(() => {
    if (!base || !orgId) return;
    void call("GET", `/api/settings/api-keys?orgId=${orgId}`).then((r) => setKeys((r.body.keys as KeyRow[]) ?? []));
  }, [base, orgId]);

  if (!base) return <EmptyState title="Settings are saved per repository">Connect a repository to choose frameworks, set the pull request check behaviour and create API keys for the CLI and MCP server.</EmptyState>;

  async function savePolicy() {
    const res = await call("PUT", `${base}/policy`, { frameworks, on_drift: onDrift });
    if (res.error) return ctx.notify(res.error, "bad");
    ctx.notify("Policy saved");
    ctx.refresh();
  }

  async function createKey() {
    setError(null);
    setNewKey(null);
    const res = await call("POST", "/api/settings/api-keys", { orgId, name: keyName });
    if (res.error) return setError(res.error);
    setNewKey(res.body.key as string);
    setKeyName("");
    const list = await call("GET", `/api/settings/api-keys?orgId=${orgId}`);
    setKeys((list.body.keys as KeyRow[]) ?? []);
  }

  async function revokeKey(id: string) {
    const res = await call("DELETE", `/api/settings/api-keys/${id}`);
    if (res.error) return ctx.notify(res.error, "bad");
    setKeys((k) => k.map((x) => (x.id === id ? { ...x, revoked_at: new Date().toISOString() } : x)));
  }

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>Pull request check</h2></div>
        <div className="panel-body stack">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Frameworks this repository reports against</legend>
            {data.frameworks.map((f) => (
              <label key={f.id} className="row" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={frameworks.includes(f.id)} onChange={(e) => setFrameworks(e.target.checked ? [...frameworks, f.id] : frameworks.filter((x) => x !== f.id))} />
                {f.name} {f.version}
              </label>
            ))}
          </fieldset>
          <Select label="When scope drift is found, the check is" value={onDrift} onChange={(e) => setOnDrift(e.target.value as "neutral" | "failure")} hint="Neutral informs. Failure blocks merging if you make the check required.">
            <option value="neutral">Neutral (informational)</option><option value="failure">Failure (blocking)</option>
          </Select>
          <div><Button variant="primary" onClick={savePolicy} disabled={!data.permissions.canAdmin}>Save policy</Button></div>
          {!data.permissions.canAdmin ? <p className="hint">Only owners and admins can change policy.</p> : null}
          <p className="hint">Settings in a <code>.trailmap.yml</code> file in the repository are read too. Values saved here win field by field.</p>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2 style={{ fontSize: "var(--step-1)" }}>API keys</h2></div>
        <div className="panel-body stack">
          <p className="muted">For <code>npx trailmap … --upload</code>, the GitHub Action and the MCP server. A key is shown once and stored only as a hash.</p>
          <div className="row" style={{ alignItems: "end" }}>
            <Input label="Key name" value={keyName} maxLength={80} onChange={(e) => setKeyName(e.target.value)} />
            <Button disabled={!keyName.trim()} onClick={createKey}>Create key</Button>
          </div>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {newKey ? <div className="notice" role="status">Copy this key now. It will not be shown again.<div className="mono" style={{ marginTop: 6, overflowWrap: "anywhere" }}>{newKey}</div></div> : null}
          {keys.length ? (
            <Table caption="API keys">
              <thead><tr><Th>Name</Th><Th>Prefix</Th><Th>Last used</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>{keys.map((k) => (
                <Tr key={k.id}><Td>{k.name}</Td><Td className="mono">{k.prefix}</Td><Td>{k.revoked_at ? <Stamp tone="bad">Revoked</Stamp> : k.last_used_at ? fmtDate(k.last_used_at) : "Never"}</Td><Td>{!k.revoked_at ? <Button size="small" variant="danger" onClick={() => revokeKey(k.id)}>Revoke</Button> : null}</Td></Tr>
              ))}</tbody>
            </Table>
          ) : null}
        </div>
      </div>
    </div>
  );
}
