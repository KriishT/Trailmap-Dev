import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { demoWorkspace } from "@/lib/demo/workspace";
import { toClientWorkspace } from "@/lib/workspace/client-data";
import { Workspace } from "@/components/workspace/workspace";

export const metadata = { title: "Sample workspace" };

/** The whole product on made-up data: no sign-in, nothing saved. Same components as a real repository. */
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ rev?: string; tab?: string }> }) {
  const { rev, tab } = await searchParams;
  const data = toClientWorkspace(demoWorkspace(rev));
  return (
    <>
      <header className="app-header">
        <div className="wrap">
          <Brand />
          <nav className="nav" aria-label="Main">
            <Link href="/demo" aria-current="page">Sample workspace</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
          <span className="spacer" />
          <ThemeToggle />
        </div>
      </header>
      <main id="main">
        <div className="wrap">
          <p className="notice" style={{ marginTop: 16 }}>
            You are looking at a sample online shop called acme/shop. Everything here is made up, and changes are not saved.
            {" "}<Link href="/sign-up">Create an account</Link> to scan your own repositories.
          </p>
        </div>
        <Workspace data={data} initialTab={tab ?? "system"} />
      </main>
    </>
  );
}
