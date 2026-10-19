import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueuePrCheck, enqueuePrRecheck, enqueueScan } from "./queue";

export type RepoPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export interface GithubApi {
  /** Look up a repo's real default branch using the installation's credentials. */
  getDefaultBranch(installationId: number, fullName: string): Promise<string>;
  /** A user's permission on a repo, used to decide who may acknowledge drift from a PR comment. */
  getPermission(installationId: number, fullName: string, login: string): Promise<RepoPermission>;
}

export interface EventDeps {
  db: SupabaseClient;
  github: GithubApi;
}

export interface EventResult {
  handled: boolean;
  detail?: string;
}

interface PushPayload {
  ref?: string;
  repository?: { id?: number; default_branch?: string };
}

interface InstallationPayload {
  action?: string;
  installation?: { id?: number; account?: { id?: number } };
  repositories_added?: Array<{ id: number; name: string; full_name: string; private: boolean }>;
  repositories_removed?: Array<{ id: number }>;
}

interface PullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: { number?: number; draft?: boolean };
  repository?: { id?: number; full_name?: string };
  installation?: { id?: number };
}

interface IssueCommentPayload {
  action?: string;
  issue?: { number?: number; pull_request?: unknown };
  comment?: { body?: string; user?: { login?: string; type?: string } };
  repository?: { id?: number; full_name?: string };
  installation?: { id?: number };
}

interface CheckRunPayload {
  action?: string;
  check_run?: { name?: string; pull_requests?: Array<{ number?: number }> };
  repository?: { id?: number };
}

export const CHECK_RUN_NAME = "Trailmap scope check";
const PR_CHECK_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);
const CAN_ACKNOWLEDGE = new Set<RepoPermission>(["admin", "maintain", "write"]);
export const ACK_COMMAND = /^\s*\/trailmap\s+ack\b/im;

/** Handle the events that change what Trailmap tracks. Scans and checks are only enqueued, never run. */
export async function handleGithubEvent(
  event: string | null,
  payload: unknown,
  deps: EventDeps
): Promise<EventResult> {
  switch (event) {
    case "push":
      return handlePush(payload as PushPayload, deps);
    case "pull_request":
      return handlePullRequest(payload as PullRequestPayload, deps);
    case "issue_comment":
      return handleIssueComment(payload as IssueCommentPayload, deps);
    case "check_run":
      return handleCheckRun(payload as CheckRunPayload, deps);
    case "installation":
      return handleInstallation(payload as InstallationPayload, deps);
    case "installation_repositories":
      return handleInstallationRepositories(payload as InstallationPayload, deps);
    default:
      return { handled: false };
  }
}

async function activeRepos(db: SupabaseClient, githubRepoId: number) {
  const { data } = await db.from("repos").select("id, full_name").eq("github_repo_id", githubRepoId).eq("is_active", true);
  return (data ?? []) as Array<{ id: string; full_name: string }>;
}

async function handlePush(payload: PushPayload, { db }: EventDeps): Promise<EventResult> {
  const branch = payload.ref?.replace("refs/heads/", "");
  const defaultBranch = payload.repository?.default_branch;
  const githubRepoId = payload.repository?.id;
  if (!branch || !githubRepoId || branch !== defaultBranch) {
    return { handled: true, detail: "skipped: not the default branch" };
  }
  const repos = await activeRepos(db, githubRepoId);
  for (const repo of repos) await enqueueScan(db, repo.id, "webhook");
  return { handled: true, detail: `enqueued ${repos.length}` };
}

async function handlePullRequest(payload: PullRequestPayload, { db }: EventDeps): Promise<EventResult> {
  const prNumber = payload.number ?? payload.pull_request?.number;
  const githubRepoId = payload.repository?.id;
  if (!payload.action || !PR_CHECK_ACTIONS.has(payload.action) || !prNumber || !githubRepoId) {
    return { handled: true, detail: "skipped: not an event that needs a check" };
  }
  const repos = await activeRepos(db, githubRepoId);
  for (const repo of repos) await enqueuePrCheck(db, repo.id, prNumber, "webhook");
  return { handled: true, detail: `enqueued PR check for ${repos.length}` };
}

async function handleCheckRun(payload: CheckRunPayload, { db }: EventDeps): Promise<EventResult> {
  if (payload.action !== "rerequested" || payload.check_run?.name !== CHECK_RUN_NAME) return { handled: false };
  const prNumber = payload.check_run?.pull_requests?.[0]?.number;
  const githubRepoId = payload.repository?.id;
  if (!prNumber || !githubRepoId) return { handled: true, detail: "skipped: no pull request" };
  const repos = await activeRepos(db, githubRepoId);
  for (const repo of repos) await enqueuePrCheck(db, repo.id, prNumber, "webhook");
  return { handled: true, detail: "re-run requested" };
}

/**
 * `/trailmap ack` on a pull request records who accepted the drift and re-runs the check.
 * Only people with write access on the repository (as reported by GitHub) may do it.
 */
async function handleIssueComment(payload: IssueCommentPayload, { db, github }: EventDeps): Promise<EventResult> {
  if (payload.action !== "created" || !payload.issue?.pull_request) return { handled: false };
  const body = payload.comment?.body ?? "";
  if (!ACK_COMMAND.test(body)) return { handled: false };
  const login = payload.comment?.user?.login;
  const prNumber = payload.issue?.number;
  const githubRepoId = payload.repository?.id;
  const installationId = payload.installation?.id;
  const fullName = payload.repository?.full_name;
  if (!login || payload.comment?.user?.type === "Bot" || !prNumber || !githubRepoId || !installationId || !fullName) {
    return { handled: true, detail: "ignored: incomplete comment event" };
  }

  const permission = await github.getPermission(installationId, fullName, login);
  if (!CAN_ACKNOWLEDGE.has(permission)) return { handled: true, detail: `ignored: ${login} has ${permission} access` };

  let acknowledged = 0;
  for (const repo of await activeRepos(db, githubRepoId)) {
    const { data: event } = await db
      .from("drift_events")
      .select("id, status, head_graph_hash")
      .eq("repo_id", repo.id)
      .eq("pr_number", prNumber)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!event || event.status === "acknowledged") continue;

    const { error } = await db.from("attestations").insert({
      repo_id: repo.id,
      kind: "drift_ack",
      graph_hash: event.head_graph_hash,
      drift_event_id: event.id,
      actor_user_id: null,
      actor_label: `${login} (GitHub)`,
      note: body.slice(0, 500),
    });
    if (error) throw new Error(`Failed to record acknowledgement: ${error.message}`);
    await enqueuePrRecheck(db, repo.id, event.id);
    acknowledged++;
  }
  return { handled: true, detail: acknowledged ? `acknowledged by ${login}` : "nothing to acknowledge" };
}

async function handleInstallation(
  payload: InstallationPayload,
  { db }: EventDeps
): Promise<EventResult> {
  const installationId = payload.installation?.id;
  if (!installationId) return { handled: false };

  if (payload.action === "created") {
    // Attach the installation to an org we already know. New orgs are created when
    // their owner signs in and syncs, because only then do we know the Trailmap user.
    const accountId = payload.installation?.account?.id;
    if (accountId) {
      await db
        .from("organizations")
        .update({ github_installation_id: installationId })
        .eq("github_org_id", accountId);
    }
    return { handled: true, detail: "installation recorded" };
  }

  if (payload.action === "deleted") {
    const { data: org } = await db
      .from("organizations")
      .select("id")
      .eq("github_installation_id", installationId)
      .maybeSingle();
    if (org) {
      await db.from("repos").update({ is_active: false }).eq("org_id", org.id);
      await db
        .from("organizations")
        .update({ github_installation_id: null })
        .eq("id", org.id);
    }
    return { handled: true, detail: "installation removed" };
  }

  return { handled: false };
}

async function handleInstallationRepositories(
  payload: InstallationPayload,
  { db, github }: EventDeps
): Promise<EventResult> {
  const installationId = payload.installation?.id;
  if (!installationId) return { handled: false };

  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("github_installation_id", installationId)
    .maybeSingle();
  if (!org) return { handled: true, detail: "unknown installation" };

  for (const repo of payload.repositories_added ?? []) {
    // Never reset a repo the user already activated: only insert ones we have not seen.
    const { data: existing } = await db
      .from("repos")
      .select("id")
      .eq("org_id", org.id)
      .eq("github_repo_id", repo.id)
      .maybeSingle();
    if (existing) continue;

    const defaultBranch = await github.getDefaultBranch(installationId, repo.full_name);
    await db.from("repos").insert({
      org_id: org.id,
      github_repo_id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      default_branch: defaultBranch,
      is_active: false,
    });
  }

  for (const repo of payload.repositories_removed ?? []) {
    await db
      .from("repos")
      .update({ is_active: false })
      .eq("org_id", org.id)
      .eq("github_repo_id", repo.id);
  }
  return { handled: true };
}
