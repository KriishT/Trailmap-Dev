import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-server";
import { MapView } from "@/components/map/map-view";

export default async function PublicMapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = supabaseAdmin();

  const { data: sharedMap } = await db
    .from("shared_maps")
    .select("id, snapshot_id, expires_at")
    .eq("slug", slug)
    .single();

  if (!sharedMap) notFound();

  if (sharedMap.expires_at && new Date(sharedMap.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        This map link has expired.
      </div>
    );
  }

  const { data: snapshot } = await db
    .from("graph_snapshots")
    .select("raw_json, node_count, edge_count, scanned_at, repos(full_name)")
    .eq("id", sharedMap.snapshot_id)
    .single();

  if (!snapshot) notFound();

  const repoName = (snapshot.repos as any)?.full_name ?? "Unknown repo";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 h-14 flex items-center gap-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(213 94% 68%)" strokeWidth="2">
          <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
        </svg>
        <span className="font-semibold text-sm">Trailmap</span>
        <span className="text-muted-foreground text-sm">·</span>
        <span className="text-sm">{repoName}</span>
        <span className="text-xs text-muted-foreground">
          {snapshot.node_count} services · {snapshot.edge_count} edges
        </span>
      </header>
      <div className="flex-1 flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
        <MapView graph={snapshot.raw_json as any} />
      </div>
    </div>
  );
}
