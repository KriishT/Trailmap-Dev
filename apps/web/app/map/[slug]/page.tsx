import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { parseStoredGraph } from "@trailmap/graph";
import { SHEET_TITLES } from "@trailmap/sheets";
import { supabasePublic } from "@/lib/supabase-public";
import { supabaseAdmin } from "@/lib/supabase-server";
import { resolveShare, unlockCookieName } from "@/lib/share";
import { renderSheet } from "@/lib/workspace/scene";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { UnlockForm } from "@/components/map/unlock-form";
import { SharedSheets } from "@/components/workspace/shared-sheets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared architecture sheets", robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="wrap">
          <Brand />
          <span className="spacer" />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="wrap page">{children}</main>
    </>
  );
}

export default async function PublicMapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [jar, hdrs] = await Promise.all([cookies(), headers()]);

  const access = await resolveShare(
    { anon: supabasePublic(), admin: supabaseAdmin(), cookieSecret: process.env.SHARE_COOKIE_SECRET },
    slug,
    {
      cookie: jar.get(unlockCookieName(slug))?.value,
      ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip"),
      userAgent: hdrs.get("user-agent"),
    }
  );

  if (access.status === "notfound") notFound();
  if (access.status === "gone") {
    return (
      <Shell>
        <div className="state" style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: "var(--step-2)" }}>This link is no longer available</h1>
          <p>{access.reason === "expired" ? "It has expired." : "It was revoked by its owner."} Ask the person who shared it for a new one.</p>
        </div>
      </Shell>
    );
  }
  if (access.status === "password") {
    return (
      <Shell>
        <div className="panel auth-card">
          <div className="panel-body stack">
            <h1 style={{ fontSize: "var(--step-2)" }}>This architecture is protected</h1>
            <p className="muted">Enter the password you were given.</p>
            <UnlockForm slug={slug} />
          </div>
        </div>
      </Shell>
    );
  }

  let graph;
  try {
    graph = parseStoredGraph(access.view.graphRaw);
  } catch {
    notFound();
  }
  const { view } = access;
  const input = { effective: graph, scopes: [], highlightNodeIds: [], highlightEdgeIds: [] };
  const kinds = (["system", "data-flow", "network"] as const).filter((k) => k !== "network" || graph.nodes.some((n) => n.iac || n.type === "network" || n.type === "loadbalancer"));
  const sheets = await Promise.all(kinds.map(async (k) => ({ id: k, title: SHEET_TITLES[k], svg: (await renderSheet(input, { sheet: k })).svg })));

  return (
    <Shell>
      <div className="page-head">
        <div>
          <p className="eyebrow">Shared read-only</p>
          <h1>{view.repoFullName}</h1>
          <p>{view.nodeCount} elements and {view.edgeCount} connections, scanned {view.scannedAt.slice(0, 10)}.</p>
        </div>
      </div>
      <SharedSheets
        sheets={sheets}
        label={view.label}
        rows={[
          { label: "Repository", value: view.repoFullName },
          { label: "Scanned", value: view.scannedAt.slice(0, 10) },
          { label: "Graph hash", value: graph.meta.graphHash ?? "not recorded" },
          ...(view.label ? [{ label: "Shared with", value: view.label }] : []),
        ]}
      />
    </Shell>
  );
}
