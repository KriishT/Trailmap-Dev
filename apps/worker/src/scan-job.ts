import * as path from "path";
import * as fs from "fs";
import * as tmp from "tmp";
import simpleGit from "simple-git";
import { scan } from "@trailmap/scanner";
import { getDb } from "./db.js";
import { getOctokit } from "./github-client.js";

export interface ScanJobData {
  scanLogId: string;
  repoId: string;
}

export async function runScanJob(data: ScanJobData): Promise<void> {
  const { scanLogId, repoId } = data;
  const db = getDb();

  // Mark as running
  await db
    .from("scan_logs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", scanLogId);

  try {
    // Fetch repo + org info
    const { data: repo } = await db
      .from("repos")
      .select("id, full_name, default_branch, org_id")
      .eq("id", repoId)
      .single();

    if (!repo) throw new Error(`Repo ${repoId} not found`);

    const { data: org } = await db
      .from("organizations")
      .select("github_installation_id")
      .eq("id", repo.org_id)
      .single();

    if (!org?.github_installation_id) throw new Error("No GitHub installation found");

    const octokit = getOctokit(org.github_installation_id);

    // Get latest commit SHA
    const [owner, repoName] = repo.full_name.split("/");
    const { data: branch } = await octokit.repos.getBranch({
      owner,
      repo: repoName,
      branch: repo.default_branch,
    });
    const commitSha = branch.commit.sha;

    // Clone to temp directory
    const tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: "trailmap-" });
    const cloneDir = tmpDir.name;

    try {
      // Get a short-lived clone URL
      const { data: installToken } = await octokit.apps.createInstallationAccessToken({
        installation_id: org.github_installation_id,
      });

      const cloneUrl = `https://x-access-token:${installToken.token}@github.com/${repo.full_name}.git`;
      const git = simpleGit();
      await git.clone(cloneUrl, cloneDir, [
        "--depth=1",
        "--single-branch",
        `--branch=${repo.default_branch}`,
      ]);

      // Run scanner
      const graph = await scan({
        rootDir: cloneDir,
        includeLibraries: false,
      });

      // Save snapshot
      const { data: snapshot, error: snapErr } = await db
        .from("graph_snapshots")
        .insert({
          repo_id: repoId,
          node_count: graph.nodes.length,
          edge_count: graph.edges.length,
          total_files: graph.meta.total_files,
          language_breakdown: graph.meta.language_breakdown,
          raw_json: graph,
          commit_sha: commitSha,
          branch: repo.default_branch,
        })
        .select("id")
        .single();

      if (snapErr) throw snapErr;

      // Update repo + scan log
      await db
        .from("repos")
        .update({ last_scanned_at: new Date().toISOString() })
        .eq("id", repoId);

      await db
        .from("scan_logs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          snapshot_id: snapshot.id,
        })
        .eq("id", scanLogId);
    } finally {
      tmpDir.removeCallback();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("scan_logs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", scanLogId);
    throw err;
  }
}
