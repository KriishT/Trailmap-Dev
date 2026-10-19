import Link from "next/link";
import { Stamp } from "@trailmap/ui";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isLocalMode } from "@/lib/local-mode";
import { RepoList, type RepoSummary } from "@/components/dashboard/repo-list";
import { ConnectGitHubButton } from "@/components/dashboard/connect-github-button";
import { SyncReposButton } from "@/components/dashboard/sync-repos-button";
import { ScanButton } from "@/components/dashboard/scan-button";

export const metadata = { title: "Repositories" };

interface Step {
  title: string;
  body: string;
  done: boolean;
  action?: React.ReactNode;
}

export default async function DashboardPage() {
  const db = await createSupabaseServerClient();
  const local = isLocalMode();

  // Row-level security limits every query below to organisations the person belongs to.
  const { data: orgs } = await db.from("organizations").select("id, github_org_name, github_installation_id");
  const orgIds = (orgs ?? []).map((o) => o.id as string);
  const { data: repoRows } = orgIds.length
    ? await db
        .from("repos")
        .select("id, name, full_name, last_scanned_at, private, is_active")
        .in("org_id", orgIds)
        .eq("is_active", true)
        .order("last_scanned_at", { ascending: false })
    : { data: [] };
  const { data: snapRows } = repoRows?.length
    ? await db.from("graph_snapshots").select("id, repo_id, node_count, edge_count, scanned_at").in("repo_id", repoRows.map((r) => r.id as string)).order("scanned_at", { ascending: false })
    : { data: [] };
  const list: RepoSummary[] = (repoRows ?? []).map((r) => ({
    ...(r as unknown as Omit<RepoSummary, "graph_snapshots">),
    graph_snapshots: (snapRows ?? []).filter((s) => s.repo_id === r.id).slice(0, 1) as unknown as RepoSummary["graph_snapshots"],
  }));
  const first = list[0];
  const scanned = list.find((r) => r.graph_snapshots?.length);

  let framework = false;
  let scoped = false;
  let exported = false;
  if (scanned) {
    const [{ data: policy }, { data: scopes }, { data: exports }] = await Promise.all([
      db.from("repo_policies").select("config").eq("repo_id", scanned.id).maybeSingle(),
      db.from("scopes").select("id").eq("repo_id", scanned.id).limit(1),
      db.from("exports").select("id").eq("repo_id", scanned.id).limit(1),
    ]);
    framework = ((policy?.config as { frameworks?: string[] } | undefined)?.frameworks ?? []).length > 0;
    scoped = (scopes ?? []).length > 0;
    exported = (exports ?? []).length > 0;
  }

  const steps: Step[] = [
    { title: "Install the GitHub App", body: "Read-only access to code, plus permission to post the pull request check.", done: (orgs ?? []).some((o) => o.github_installation_id), action: <ConnectGitHubButton variant="primary" local={local} /> },
    { title: "Choose repositories", body: "Only the ones you pick are read.", done: list.length > 0, action: <SyncReposButton variant="primary" /> },
    { title: "Run the first scan", body: "Takes about a minute. The code is cloned to a temporary folder and deleted afterwards; only the graph is kept.", done: Boolean(scanned), action: first ? <ScanButton repoId={first.id} local={local} label="Run first scan" variant="primary" /> : undefined },
    { title: "Pick a framework", body: "PCI DSS, SOC 2 or DORA decides which requirement notes your export carries.", done: framework, action: scanned ? <Link className="btn" href={`/repos/${scanned.id}?tab=settings`}>Choose framework</Link> : undefined },
    { title: "Define your scope", body: "Mark the boxes that hold regulated data. Pull requests that cross it get flagged.", done: scoped, action: scanned ? <Link className="btn" href={`/repos/${scanned.id}?tab=scopes`}>Edit scope</Link> : undefined },
    { title: "Export your first pack", body: "A PDF with title block, sheets, vendor inventory and revision history.", done: exported, action: scanned ? <Link className="btn" href={`/repos/${scanned.id}?tab=export`}>Open export</Link> : undefined },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Repositories</h1>
          <p>{list.length} {list.length === 1 ? "repository" : "repositories"} selected.</p>
        </div>
        <div className="row">
          <SyncReposButton label="Choose repositories" />
          <ConnectGitHubButton label="GitHub App settings" local={local} />
        </div>
      </div>

      <div className="stack">
        {list.length > 0 ? <RepoList repos={list} local={local} /> : null}

        {doneCount < steps.length ? (
          <section className="panel" aria-labelledby="setup-title">
            <div className="panel-head">
              <h2 id="setup-title" style={{ fontSize: "var(--step-1)" }}>Setup</h2>
              <Stamp tone="plain">{doneCount} of {steps.length} done</Stamp>
            </div>
            <ol className="timeline" style={{ padding: "0 14px" }}>
              {steps.map((s, i) => (
                <li key={s.title} aria-current={i === nextIndex ? "step" : undefined}>
                  <div className="rev">{s.done ? "Done" : `Step ${i + 1}`}</div>
                  <div className="stack" style={{ gap: 6 }}>
                    <strong>{s.title}</strong>
                    <span className="muted">{s.body}</span>
                    {i === nextIndex && s.action ? <div>{s.action}</div> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <p className="muted">
          Want to see the finished result first? <Link href="/demo">Open the sample workspace</Link>. It needs no sign-in and uses made-up data.
        </p>
      </div>
    </div>
  );
}
