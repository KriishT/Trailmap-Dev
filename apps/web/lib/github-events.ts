import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueScan } from "./queue";

export interface GithubApi {
  /** Look up a repo's real default branch using the installation's credentials. */
  getDefaultBranch(installationId: number, fullName: string): Promise<string>;
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

/** Handle the events that change what Trailmap tracks. Scans are only enqueued, never run. */
export async function handleGithubEvent(
  event: string | null,
  payload: unknown,
  deps: EventDeps
): Promise<EventResult> {
  switch (event) {
    case "push":
      return handlePush(payload as PushPayload, deps);
    case "installation":
      return handleInstallation(payload as InstallationPayload, deps);
    case "installation_repositories":
      return handleInstallationRepositories(payload as InstallationPayload, deps);
    default:
      return { handled: false };
  }
}

async function handlePush(payload: PushPayload, { db }: EventDeps): Promise<EventResult> {
  const branch = payload.ref?.replace("refs/heads/", "");
  const defaultBranch = payload.repository?.default_branch;
  const githubRepoId = payload.repository?.id;
  if (!branch || !githubRepoId || branch !== defaultBranch) {
    return { handled: true, detail: "skipped: not the default branch" };
  }

  const { data: repos } = await db
    .from("repos")
    .select("id")
    .eq("github_repo_id", githubRepoId)
    .eq("is_active", true);

  for (const repo of repos ?? []) {
    await enqueueScan(db, repo.id, "webhook");
  }
  return { handled: true, detail: `enqueued ${repos?.length ?? 0}` };
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
