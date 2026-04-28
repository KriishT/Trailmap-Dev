import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";
import { UserMenu } from "@/components/dashboard/user-menu";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  return (
    <div style={{ minHeight: "100vh", background: "#FAF8F5" }}>
      <header style={{
        borderBottom: "1px solid rgba(26,15,8,0.07)",
        background: "rgba(250,248,245,0.95)",
        backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 32px", height: "56px", display: "flex", alignItems: "center", gap: "12px" }}>
          <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E8754A" strokeWidth="2.5">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            </svg>
            <span className="font-body font-semibold text-sm" style={{ color: "#1A0F08" }}>Trailmap</span>
          </Link>

          <div style={{ width: "1px", height: "16px", background: "rgba(26,15,8,0.1)", margin: "0 4px" }} />

          <Link href="/dashboard" className="font-body" style={{ fontSize: "0.85rem", color: "rgba(26,15,8,0.45)", textDecoration: "none", padding: "4px 8px", borderRadius: "8px" }}>
            Repos
          </Link>

          <div style={{ marginLeft: "auto" }}>
            <UserMenu email={user.email ?? ""} avatarUrl={user.user_metadata?.avatar_url} />
          </div>
        </div>
      </header>
      <div>{children}</div>
    </div>
  );
}
