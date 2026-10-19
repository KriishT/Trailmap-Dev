import * as fs from "node:fs";
import * as path from "node:path";
import {
  analyzeChangedFiles, applyOverrides, computeGraphHash, driftFingerprint, evaluateDrift, matchOwnersForPath,
  parseCodeowners, parseStoredGraph, prepareGraphForWrite, type DependencyGraph, type DriftFinding,
} from "@trailmap/graph";
import { loadComplianceContext, resolvePolicy, scopesFromPolicy } from "./context.js";
import { CHECK_NAME, PR_COMMENT_MARKER, renderCheck, renderComment, type RenderInput } from "./pr-comment.js";
import type { CheckConclusion, JobOutcome, PipelineDeps, ScanJob } from "./types.js";

const readIfExists = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const CODEOWNERS_LOCATIONS = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"];

interface RepoRow {
  id: string;
  full_name: string;
  default_branch: string;
  org_id: string;
}

async function loadRepo(deps: PipelineDeps, repoId: string): Promise<{ repo: RepoRow; installationId: number }> {
  const { data: repo } = await deps.db.from("repos").select("id, full_name, default_branch, org_id").eq("id", repoId).single();
  if (!repo) throw new Error(`Repo ${repoId} not found`);
  const { data: org } = await deps.db.from("organizations").select("github_installation_id").eq("id", repo.org_id).single();
  if (!org?.github_installation_id) throw new Error("No GitHub installation found for this repo");
  return { repo: repo as RepoRow, installationId: org.github_installation_id as number };
}

const emptyGraph = (repo: string): DependencyGraph => ({
  meta: { repo, scanned_at: new Date(0).toISOString(), language_breakdown: {}, total_files: 0 },
  nodes: [],
  edges: [],
});

function redact(message: string, secrets: string[]): string {
  let out = message.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
  for (const s of secrets) if (s) out = out.split(s).join("***");
  return out;
}

/**
 * Check a pull request for architecture and compliance-scope drift.
 *
 * The PR head is cloned into a temp dir, scanned, compared with the latest snapshot of the
 * default branch, and judged against the repo policy and scopes. The result is published as a
 * check run and one upserted comment. Only the graph and findings are stored.
 */
export async function runPrCheck(job: ScanJob, deps: PipelineDeps): Promise<JobOutcome> {
  const { db, github } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const secrets: string[] = [];

  try {
    const prNumber = Number(job.payload?.prNumber);
    if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error("pr_check job has no valid prNumber");
    const { repo, installationId } = await loadRepo(deps, job.repoId);

    const pr = await github.getPullRequest({ installationId, fullName: repo.full_name, prNumber });
    const access = await github.getCloneAccess({ installationId, fullName: repo.full_name, branch: repo.default_branch });
    secrets.push(access.token);

    const tmp = deps.tempDir();
    let head: DependencyGraph;
    let policyText: string | null;
    let ownersText: string | null = null;
    try {
      await deps.cloner({
        url: `https://x-access-token:${access.token}@github.com/${repo.full_name}.git`,
        branch: repo.default_branch,
        ref: `refs/pull/${prNumber}/head`,
        dir: tmp.path,
      });
      head = prepareGraphForWrite(await deps.scan({ rootDir: tmp.path, repoName: repo.full_name, includeLibraries: false }));
      policyText = readIfExists(path.join(tmp.path, ".trailmap.yml")) ?? readIfExists(path.join(tmp.path, ".trailmap.yaml"));
      for (const loc of CODEOWNERS_LOCATIONS) {
        ownersText = readIfExists(path.join(tmp.path, loc));
        if (ownersText) break;
      }
    } finally {
      tmp.cleanup();
    }

    const ctx = await loadComplianceContext(db, job.repoId);
    const { policy, errors: policyErrors } = resolvePolicy(policyText, ctx.appPolicy);
    const scopes = [...ctx.scopes, ...scopesFromPolicy(policy)];

    const { data: baseRow } = await db
      .from("graph_snapshots")
      .select("id, raw_json")
      .eq("repo_id", job.repoId)
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // A baseline we cannot read is treated like no baseline, with a visible warning, not a crash.
    let baseRaw: DependencyGraph | null = null;
    if (baseRow) {
      try {
        baseRaw = parseStoredGraph(baseRow.raw_json);
      } catch {
        policyErrors.push("The latest stored snapshot could not be read, so there is no baseline to compare against.");
      }
    }
    const noBaseline = baseRaw === null;
    const baseGraph = baseRaw ?? emptyGraph(repo.full_name);

    // Human decisions apply to both sides so that a hidden edge stays hidden and does not look like drift.
    const base = applyOverrides(baseGraph, ctx.overrides).graph;
    const effectiveHead = applyOverrides(head, ctx.overrides).graph;
    const headHash = head.meta.graphHash ?? computeGraphHash(head);

    const drift = noBaseline
      ? { findings: [] as DriftFinding[], ignored: [] as DriftFinding[], conclusion: "neutral" as CheckConclusion, summary: "No baseline snapshot to compare against." }
      : evaluateDrift({ base, head: effectiveHead, scopes, policy });
    const fingerprint = driftFingerprint(drift.findings);

    const files = await github.listPullRequestFiles({ installationId, fullName: repo.full_name, prNumber });
    const rules = ownersText ? parseCodeowners(ownersText) : [];
    const impact = analyzeChangedFiles(effectiveHead, files, (p) => matchOwnersForPath(p, rules));

    // Same commit re-checked after someone acknowledged it: stay green.
    const { data: existing } = await db
      .from("drift_events")
      .select("id, status, acknowledged_by, check_run_id, comment_id, fingerprint")
      .eq("repo_id", job.repoId)
      .eq("pr_number", prNumber)
      .eq("head_sha", pr.headSha)
      .maybeSingle();
    const stillAcknowledged = Boolean(existing && existing.status === "acknowledged" && existing.fingerprint === fingerprint);
    const acknowledgedBy = stillAcknowledged ? (existing!.acknowledged_by as string | null) : null;
    const conclusion: CheckConclusion = stillAcknowledged ? "success" : drift.conclusion;

    const render: RenderInput = {
      fullName: repo.full_name, headSha: pr.headSha, prNumber, conclusion, summary: drift.summary,
      findings: drift.findings, ignoredCount: drift.ignored.length, impact, policyErrors, noBaseline, acknowledgedBy,
      appLink: deps.appUrl ? `${deps.appUrl.replace(/\/$/, "")}/repos/${job.repoId}` : undefined,
    };
    const check = renderCheck(render);

    const checkRun = await github.createCheckRun({
      installationId, fullName: repo.full_name, headSha: pr.headSha, name: CHECK_NAME, conclusion, ...check,
    });
    const comment = await github.upsertPullRequestComment({
      installationId, fullName: repo.full_name, prNumber, marker: PR_COMMENT_MARKER, body: renderComment(render),
    });

    const row = {
      repo_id: job.repoId, pr_number: prNumber, head_sha: pr.headSha,
      base_snapshot_id: noBaseline ? null : (baseRow?.id ?? null), head_graph_hash: headHash,
      findings: drift.findings, ignored: drift.ignored, fingerprint, summary: drift.summary, impact,
      policy_errors: policyErrors, conclusion,
      status: stillAcknowledged ? "acknowledged" : "open",
      check_run_id: checkRun.id, comment_id: comment.id,
      ...(stillAcknowledged ? { acknowledged_by: acknowledgedBy } : {}),
    };
    const { data: saved, error } = await db
      .from("drift_events")
      .upsert(row, { onConflict: "repo_id,pr_number,head_sha" })
      .select("id")
      .single();
    if (error || !saved) throw new Error(`Failed to save drift event: ${error?.message ?? "no row"}`);

    await db.from("scan_logs").update({ status: "completed", completed_at: now() }).eq("id", job.scanLogId);
    return { status: "completed", scanLogId: job.scanLogId, driftEventId: saved.id as string, conclusion };
  } catch (err) {
    const error = redact(err instanceof Error ? err.message : String(err), secrets);
    await db.from("scan_logs").update({ status: "failed", error_message: error, completed_at: now() }).eq("id", job.scanLogId);
    return { status: "failed", scanLogId: job.scanLogId, error };
  }
}

/**
 * Re-evaluate a PR check after an acknowledgement. No clone or scan: it checks that an
 * attestation exists for exactly the graph that was reported, then flips the check to success.
 */
export async function runPrRecheck(job: ScanJob, deps: PipelineDeps): Promise<JobOutcome> {
  const { db, github } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  try {
    const driftEventId = String(job.payload?.driftEventId ?? "");
    if (!driftEventId) throw new Error("pr_recheck job has no driftEventId");
    const { repo, installationId } = await loadRepo(deps, job.repoId);

    const { data: event } = await db.from("drift_events").select("*").eq("id", driftEventId).eq("repo_id", job.repoId).maybeSingle();
    if (!event) throw new Error("Drift event not found");

    const { data: atts } = await db
      .from("attestations")
      .select("actor_label, graph_hash, kind, drift_event_id")
      .eq("repo_id", job.repoId)
      .eq("drift_event_id", driftEventId)
      .order("created_at", { ascending: false });
    // The acknowledgement must be for this exact commit's graph, not an earlier push.
    const valid = (atts ?? []).find((a) => a.kind === "drift_ack" && a.graph_hash === event.head_graph_hash);
    if (!valid) throw new Error("No acknowledgement matches this commit's graph");

    const acknowledgedBy = valid.actor_label as string;
    const render: RenderInput = {
      fullName: repo.full_name, headSha: event.head_sha as string, prNumber: event.pr_number as number,
      conclusion: "success", summary: event.summary as string,
      findings: event.findings as DriftFinding[], ignoredCount: (event.ignored as unknown[]).length,
      impact: event.impact && Object.keys(event.impact as object).length ? (event.impact as never) : null,
      policyErrors: (event.policy_errors as string[]) ?? [], noBaseline: false, acknowledgedBy,
      appLink: deps.appUrl ? `${deps.appUrl.replace(/\/$/, "")}/repos/${job.repoId}` : undefined,
    };
    const check = renderCheck(render);

    if (event.check_run_id) {
      await github.updateCheckRun({ installationId, fullName: repo.full_name, checkRunId: event.check_run_id as number, conclusion: "success", ...check });
    } else {
      const created = await github.createCheckRun({ installationId, fullName: repo.full_name, headSha: event.head_sha as string, name: CHECK_NAME, conclusion: "success", ...check });
      await db.from("drift_events").update({ check_run_id: created.id }).eq("id", driftEventId);
    }
    await github.upsertPullRequestComment({
      installationId, fullName: repo.full_name, prNumber: event.pr_number as number, marker: PR_COMMENT_MARKER, body: renderComment(render),
    });
    await db.from("drift_events").update({ status: "acknowledged", conclusion: "success", acknowledged_by: acknowledgedBy, acknowledged_at: now() }).eq("id", driftEventId);
    await db.from("scan_logs").update({ status: "completed", completed_at: now() }).eq("id", job.scanLogId);
    return { status: "completed", scanLogId: job.scanLogId, driftEventId, conclusion: "success" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.from("scan_logs").update({ status: "failed", error_message: error, completed_at: now() }).eq("id", job.scanLogId);
    return { status: "failed", scanLogId: job.scanLogId, error };
  }
}
