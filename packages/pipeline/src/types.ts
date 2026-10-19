import type { SupabaseClient } from "@supabase/supabase-js";
import type { DependencyGraph, ScanOptionsLike } from "./scanner-port.js";

export interface ScanJob {
  scanLogId: string;
  repoId: string;
}

/** What the pipeline needs from GitHub. The worker implements this with Octokit. */
export interface GithubPort {
  /** Short-lived read credential for cloning, plus the current head commit of `branch`. */
  getCloneAccess(args: {
    installationId: number;
    fullName: string;
    branch: string;
  }): Promise<{ token: string; headSha: string }>;
}

export interface Cloner {
  (args: { url: string; branch: string; dir: string }): Promise<void>;
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
  now?: () => Date;
}

export type JobOutcome =
  | { status: "idle" }
  | { status: "completed"; scanLogId: string; snapshotId: string }
  | { status: "failed"; scanLogId: string; error: string };
