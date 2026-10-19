import { prepareGraphForWrite } from "@trailmap/graph";
import type { PipelineDeps, ScanJob, JobOutcome } from "./types.js";
import { runPrCheck, runPrRecheck } from "./pr-check.js";

const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Atomically claim the oldest pending scan. Backed by the claim_scan_job() Postgres function
 * (FOR UPDATE SKIP LOCKED), so concurrent workers never receive the same job.
 */
export async function claimNextJob(db: PipelineDeps["db"]): Promise<ScanJob | null> {
  const { data, error } = await db.rpc("claim_scan_job");
  if (error) throw new Error(`claim_scan_job failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    scanLogId: row.id as string,
    repoId: row.repo_id as string,
    kind: (row.kind as ScanJob["kind"]) ?? "scan",
    payload: (row.payload as Record<string, unknown>) ?? {},
  };
}

/** Fail jobs whose worker died mid-scan so they do not look "running" forever. */
export async function failStaleJobs(deps: Pick<PipelineDeps, "db" | "now">): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  await deps.db
    .from("scan_logs")
    .update({
      status: "failed",
      error_message: "Worker stopped before the scan finished",
      completed_at: now.toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", cutoff);
}

/** Claim and run at most one job. Never throws for a job failure; it is recorded on the log. */
export async function processNextJob(deps: PipelineDeps): Promise<JobOutcome> {
  await failStaleJobs(deps);
  const job = await claimNextJob(deps.db);
  if (!job) return { status: "idle" };
  if (job.kind === "pr_check") return runPrCheck(job, deps);
  if (job.kind === "pr_recheck") return runPrRecheck(job, deps);
  return runScanJob(job, deps);
}

/** Strip anything that looks like a credential before it can reach logs or the database. */
function redact(message: string, secrets: string[]): string {
  let out = message.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return out;
}

/**
 * Run one already-claimed job: clone, scan, snapshot, clean up.
 * The clone lives in a temp dir that is removed whether the scan succeeds or fails;
 * only the validated graph is persisted.
 */
export async function runScanJob(job: ScanJob, deps: PipelineDeps): Promise<JobOutcome> {
  const { db } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const secrets: string[] = [];

  try {
    const { data: repo } = await db
      .from("repos")
      .select("id, full_name, default_branch, org_id")
      .eq("id", job.repoId)
      .single();
    if (!repo) throw new Error(`Repo ${job.repoId} not found`);

    const { data: org } = await db
      .from("organizations")
      .select("github_installation_id")
      .eq("id", repo.org_id)
      .single();
    if (!org?.github_installation_id) throw new Error("No GitHub installation found for this repo");

    const { token, headSha } = await deps.github.getCloneAccess({
      installationId: org.github_installation_id,
      fullName: repo.full_name,
      branch: repo.default_branch,
    });
    secrets.push(token);

    const tmp = deps.tempDir();
    try {
      await deps.cloner({
        url: `https://x-access-token:${token}@github.com/${repo.full_name}.git`,
        branch: repo.default_branch,
        dir: tmp.path,
      });

      const scanned = await deps.scan({
        rootDir: tmp.path,
        repoName: repo.full_name,
        includeLibraries: false,
      });
      const graph = prepareGraphForWrite(scanned);

      const { data: snapshot, error: snapErr } = await db
        .from("graph_snapshots")
        .insert({
          repo_id: job.repoId,
          node_count: graph.nodes.length,
          edge_count: graph.edges.length,
          total_files: graph.meta.total_files,
          language_breakdown: graph.meta.language_breakdown,
          raw_json: graph,
          commit_sha: headSha,
          branch: repo.default_branch,
        })
        .select("id")
        .single();
      if (snapErr || !snapshot) throw new Error(`Failed to save snapshot: ${snapErr?.message ?? "no row"}`);

      await db.from("repos").update({ last_scanned_at: now() }).eq("id", job.repoId);
      await db
        .from("scan_logs")
        .update({ status: "completed", completed_at: now(), snapshot_id: snapshot.id })
        .eq("id", job.scanLogId);

      return { status: "completed", scanLogId: job.scanLogId, snapshotId: snapshot.id as string };
    } finally {
      tmp.cleanup();
    }
  } catch (err) {
    const error = redact(err instanceof Error ? err.message : String(err), secrets);
    await db
      .from("scan_logs")
      .update({ status: "failed", error_message: error, completed_at: now() })
      .eq("id", job.scanLogId);
    return { status: "failed", scanLogId: job.scanLogId, error };
  }
}
