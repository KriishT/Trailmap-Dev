import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isLocalMode } from "@/lib/local-mode";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/dashboard/user-menu";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  return (
    <>
      <header className="app-header">
        <div className="wrap">
          <Brand href="/dashboard" />
          <nav className="nav" aria-label="Main">
            <Link href="/dashboard">Repositories</Link>
            <Link href="/demo">Sample workspace</Link>
          </nav>
          <span className="spacer" />
          <ThemeToggle />
          <UserMenu email={user.email ?? ""} local={isLocalMode()} />
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
