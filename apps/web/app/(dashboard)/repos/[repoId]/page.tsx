import { notFound } from "next/navigation";
import Link from "next/link";
import { EmptyState } from "@trailmap/ui";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isLocalMode } from "@/lib/local-mode";
import { isUuid } from "@/lib/authz";
import { loadWorkspace } from "@/lib/workspace/load";
import { toClientWorkspace } from "@/lib/workspace/client-data";
import { Workspace } from "@/components/workspace/workspace";
import { ScanButton } from "@/components/dashboard/scan-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace" };

export default async function RepoWorkspacePage({ params, searchParams }: { params: Promise<{ repoId: string }>; searchParams: Promise<{ rev?: string; asOf?: string; tab?: string }> }) {
  const { repoId } = await params;
  const { rev, asOf, tab } = await searchParams;
  if (!isUuid(repoId)) notFound();

  // The signed-in person's client: row-level security decides whether this repository exists for them.
  const db = await createSupabaseServerClient();
  const data = await loadWorkspace(db, repoId, { rev: rev ?? null, asOf: asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null });
  if (!data) {
    const { data: repo } = await db.from("repos").select("id, full_name").eq("id", repoId).maybeSingle();
    if (!repo) notFound();
    return (
      <div className="wrap page">
        <p><Link href="/dashboard">Repositories</Link></p>
        <h1 className="mono" style={{ margin: "12px 0" }}>{repo.full_name as string}</h1>
        <EmptyState title="No scan yet" action={<ScanButton repoId={repoId} local={isLocalMode()} label="Run first scan" variant="primary" />}>
          Trailmap has not read this repository yet. The first scan takes about a minute. The code is cloned to a temporary folder and deleted afterwards; only the graph is kept.
        </EmptyState>
      </div>
    );
  }
  return <Workspace data={toClientWorkspace(data)} initialTab={tab ?? "system"} />;
}
