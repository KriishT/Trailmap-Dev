import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { MapView } from "@/components/map/map-view";
import { ShareButton } from "@/components/map/share-button";
import { ArrowLeft } from "lucide-react";

export default async function RepoMapPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const db = supabaseAdmin();

  const { data: repo } = await db
    .from("repos")
    .select("id, name, full_name, last_scanned_at")
    .eq("id", repoId)
    .single();

  if (!repo) notFound();

  const { data: snapshot } = await db
    .from("graph_snapshots")
    .select("id, raw_json, node_count, edge_count, scanned_at, commit_sha")
    .eq("repo_id", repoId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .single();

  if (!snapshot) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", height: "calc(100vh - 56px)", background: "#FAF8F5" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "rgba(232,117,74,0.08)", border: "1px solid rgba(232,117,74,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E8754A" strokeWidth="1.5">
            <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
          </svg>
        </div>
        <p className="font-body" style={{ fontSize: "0.875rem", color: "rgba(26,15,8,0.4)" }}>No scan yet — trigger one from the dashboard.</p>
        <Link href="/dashboard" className="btn-outline" style={{ fontSize: "0.8rem", padding: "8px 16px", textDecoration: "none" }}>Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      {/* Toolbar */}
      <div style={{
        padding: "0 20px", height: "44px",
        display: "flex", alignItems: "center", gap: "12px",
        borderBottom: "1px solid rgba(26,15,8,0.07)",
        background: "rgba(250,248,245,0.95)",
        backdropFilter: "blur(12px)",
        flexShrink: 0,
      }}>
        <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: "4px", color: "rgba(26,15,8,0.4)", textDecoration: "none", fontSize: "0.8rem" }}>
          <ArrowLeft size={13} /> Repos
        </Link>
        <div style={{ width: "1px", height: "14px", background: "rgba(26,15,8,0.1)" }} />
        <span className="font-body" style={{ fontSize: "0.875rem", fontWeight: 500, color: "#1A0F08" }}>{repo.full_name}</span>
        <div style={{ width: "1px", height: "14px", background: "rgba(26,15,8,0.1)" }} />
        <span className="font-body" style={{ fontSize: "0.75rem", color: "rgba(26,15,8,0.4)" }}>
          <span style={{ color: "#E8754A" }}>{snapshot.node_count}</span> services ·{" "}
          <span style={{ color: "#E8754A" }}>{snapshot.edge_count}</span> edges
          {snapshot.commit_sha && <span style={{ marginLeft: "8px", fontFamily: "monospace", fontSize: "0.7rem", color: "rgba(26,15,8,0.25)" }}>{snapshot.commit_sha.slice(0, 7)}</span>}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <ShareButton snapshotId={snapshot.id} />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex" }}>
        <MapView graph={snapshot.raw_json as any} />
      </div>
    </div>
  );
}