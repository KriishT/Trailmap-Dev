import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { RepoList } from "@/components/dashboard/repo-list";
import { ConnectGitHubButton } from "@/components/dashboard/connect-github-button";
import { SyncReposButton } from "@/components/dashboard/sync-repos-button";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = supabaseAdmin();

  const { data: orgs } = await db
    .from("organizations")
    .select("id, github_org_name, github_installation_id")
    .eq("owner_user_id", user!.id);

  const { data: repos } = orgs?.length
    ? await db
        .from("repos")
        .select(`id, name, full_name, last_scanned_at, private, is_active,
          graph_snapshots (id, node_count, edge_count, scanned_at)`)
        .in("org_id", orgs.map((o) => o.id))
        .eq("is_active", true)
        .order("last_scanned_at", { ascending: false })
    : { data: [] };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "40px 32px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <p className="font-body" style={{ fontSize: "0.7rem", color: "#E8754A", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "6px", fontWeight: 500 }}>
            Your workspace
          </p>
          <h1 className="font-display" style={{ fontSize: "1.8rem", fontWeight: 700, color: "#1A0F08", letterSpacing: "-0.02em" }}>
            Repositories
          </h1>
          <p className="font-body" style={{ fontSize: "0.85rem", color: "rgba(26,15,8,0.4)", marginTop: "4px" }}>
            {repos?.length ?? 0} selected · Only chosen repositories appear here
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <SyncReposButton label="Choose repos" />
          <ConnectGitHubButton label="Install GitHub App" />
        </div>
      </div>

      {repos && repos.length > 0 ? (
        <RepoList repos={repos as any} />
      ) : (
        <div style={{
          border: "1.5px dashed rgba(26,15,8,0.12)",
          borderRadius: "20px",
          padding: "64px 32px",
          textAlign: "center",
          background: "rgba(255,255,255,0.5)",
        }}>
          <div style={{
            width: "48px", height: "48px", borderRadius: "14px", margin: "0 auto 16px",
            background: "rgba(232,117,74,0.08)", border: "1px solid rgba(232,117,74,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E8754A" strokeWidth="1.5">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            </svg>
          </div>
          <h2 className="font-display" style={{ fontSize: "1.1rem", fontWeight: 600, color: "#1A0F08", marginBottom: "8px", letterSpacing: "-0.01em" }}>
            No maps generated yet
          </h2>
          <p className="font-body" style={{ fontSize: "0.875rem", color: "rgba(26,15,8,0.4)", marginBottom: "24px", maxWidth: "320px", margin: "0 auto 24px", lineHeight: 1.6, fontWeight: 300 }}>
            Install the GitHub App, then choose which repositories belong in this workspace.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <SyncReposButton label="Choose repos" />
            <ConnectGitHubButton label="Install GitHub App" />
          </div>
        </div>
      )}
    </div>
  );
}
