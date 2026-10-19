import type { SupabaseClient } from "@supabase/supabase-js";
import type { DependencyGraph, ScanOptionsLike } from "./scanner-port.js";

export type JobKind = "scan" | "pr_check" | "pr_recheck";

export interface ScanJob {
  scanLogId: string;
  repoId: string;
  kind?: JobKind;
  payload?: Record<string, unknown>;
}

export type CheckConclusion = "success" | "neutral" | "failure";

export interface PullRequestInfo {
  number: number;
  headSha: string;
  baseRef: string;
  headRef: string;
  title: string;
  state: string;
}

/** What the pipeline needs from GitHub. The worker implements this with Octokit. */
export interface GithubPort {
  /** Short-lived read credential for cloning, plus the current head commit of `branch`. */
  getCloneAccess(args: {
    installationId: number;
    fullName: string;
    branch: string;
  }): Promise<{ token: string; headSha: string }>;
  getPullRequest(args: { installationId: number; fullName: string; prNumber: number }): Promise<PullRequestInfo>;
  listPullRequestFiles(args: { installationId: number; fullName: string; prNumber: number }): Promise<string[]>;
  createCheckRun(args: {
    installationId: number;
    fullName: string;
    headSha: string;
    name: string;
    conclusion: CheckConclusion;
    title: string;
    summary: string;
    text: string;
  }): Promise<{ id: number }>;
  updateCheckRun(args: {
    installationId: number;
    fullName: string;
    checkRunId: number;
    conclusion: CheckConclusion;
    title: string;
    summary: string;
    text: string;
  }): Promise<void>;
  /** Create or update the single Trailmap comment on a PR, found by its hidden marker. */
  upsertPullRequestComment(args: {
    installationId: number;
    fullName: string;
    prNumber: number;
    marker: string;
    body: string;
  }): Promise<{ id: number }>;
}

export interface Cloner {
  /** `ref` clones a specific ref (for example `refs/pull/7/head`) instead of a branch. */
  (args: { url: string; branch: string; dir: string; ref?: string }): Promise<void>;
}

export interface TempDir {
  path: string;
  /** Must remove the directory and everything in it. Called on success and on failure. */
  cleanup(): void;
}

export interface PipelineDeps {
  db: SupabaseClient;
  github: GithubPort;
  cloner: Cloner;
  tempDir: () => TempDir;
  scan: (options: ScanOptionsLike) => Promise<DependencyGraph>;
  /** Base URL of the web app, for links in comments and check runs. */
  appUrl?: string;
  now?: () => Date;
}

export type JobOutcome =
  | { status: "idle" }
  | { status: "completed"; scanLogId: string; snapshotId: string }
  | { status: "completed"; scanLogId: string; driftEventId: string; conclusion: CheckConclusion }
  | { status: "failed"; scanLogId: string; error: string };
