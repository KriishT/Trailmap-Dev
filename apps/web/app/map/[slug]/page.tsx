import { notFound } from "next/navigation";
import { supabasePublic } from "@/lib/supabase-public";
import { MapView } from "@/components/map/map-view";

export default async function PublicMapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Anonymous resolver: returns one row for a live slug, nothing for unknown or expired ones.
  const { data } = await supabasePublic().rpc("get_shared_map", { p_slug: slug });
  const shared = Array.isArray(data) ? data[0] : null;
  if (!shared) notFound();

  if (shared.requires_password) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm">
        This map is password protected. Password entry is not available yet.
      </div>
    );
  }

  const snapshot = shared;
  const repoName = shared.repo_full_name ?? "Unknown repo";

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
