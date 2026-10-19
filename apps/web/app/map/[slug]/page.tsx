import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabasePublic } from "@/lib/supabase-public";
import { supabaseAdmin } from "@/lib/supabase-server";
import { readSnapshotGraph } from "@/lib/graph-read";
import { resolveShare, unlockCookieName } from "@/lib/share";
import { MapView } from "@/components/map/map-view";
import { UnlockForm } from "@/components/map/unlock-form";

export const dynamic = "force-dynamic";

const centered: React.CSSProperties = { minHeight: "100vh", display: "flex", flexDirection: "column", gap: 16, alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" };

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
      <main style={centered}>
        <h1 style={{ margin: 0 }}>This link is no longer available</h1>
        <p style={{ margin: 0 }}>{access.reason === "expired" ? "It has expired." : "It was revoked by its owner."} Ask the person who shared it for a new one.</p>
      </main>
    );
  }
  if (access.status === "password") {
    return (
      <main style={centered}>
        <h1 style={{ margin: 0 }}>This architecture map is protected</h1>
        <p style={{ margin: 0 }}>Enter the password you were given.</p>
        <UnlockForm slug={slug} />
      </main>
    );
  }

  const graph = readSnapshotGraph(access.view.graphRaw);
  if (!graph) notFound();
  const { view } = access;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
      <header style={{ borderBottom: "1px solid #ccc", padding: "0 24px", height: 56, display: "flex", alignItems: "center", gap: 12 }}>
        <strong>Trailmap</strong>
        <span>{view.repoFullName}</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{view.nodeCount} nodes, {view.edgeCount} connections, scanned {new Date(view.scannedAt).toISOString().slice(0, 10)}</span>
        {view.label && <span style={{ marginLeft: "auto", fontSize: 12, border: "1px solid currentColor", padding: "2px 8px" }}>Shared with {view.label}</span>}
      </header>
      {view.label && (
        <div aria-hidden style={{ position: "absolute", inset: 56, pointerEvents: "none", overflow: "hidden", opacity: 0.07, fontSize: 28, fontWeight: 700, transform: "rotate(-24deg)", transformOrigin: "center", lineHeight: 3.2, whiteSpace: "pre-wrap", zIndex: 5 }}>
          {Array.from({ length: 60 }, () => `${view.label}   `).join("")}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
        <MapView graph={graph} />
      </div>
    </div>
  );
}
