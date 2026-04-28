import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { scan } from "@trailmap/scanner";
import { supabaseAdmin } from "./supabase-server";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import simpleGit from "simple-git";

export async function scanRepo(repoId: string, scanLogId: string) {
  const db = supabaseAdmin();

  await db.from("scan_logs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", scanLogId);

  try {
    const { data: repo } = await db
      .from("repos")
      .select("id, full_name, default_branch, org_id")
      .eq("id", repoId)
      .single();

    if (!repo) throw new Error("Repo not found");

    const { data: org } = await db
      .from("organizations")
      .select("github_installation_id")
      .eq("id", repo.org_id)
      .single();

    if (!org?.github_installation_id) throw new Error("No installation found");

    const appId = process.env.GITHUB_APP_ID!;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
    const installationId = org.github_installation_id;

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
    });

    // Get commit SHA
    const [owner, repoName] = repo.full_name.split("/");
    const { data: branch } = await octokit.repos.getBranch({
      owner, repo: repoName, branch: repo.default_branch,
    });
    const commitSha = branch.commit.sha;

    // Get installation token for cloning
    const { data: tokenData } = await octokit.apps.createInstallationAccessToken({ installation_id: installationId });
    const cloneUrl = `https://x-access-token:${tokenData.token}@github.com/${repo.full_name}.git`;

    // Clone to temp dir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-"));
    try {
      await simpleGit().clone(cloneUrl, tmpDir, ["--depth=1", `--branch=${repo.default_branch}`]);

      const graph = await scan({ rootDir: tmpDir });

      // Fix node names: replace temp dir name with actual repo/service name
      const repoName = repo.full_name.split("/")[1] ?? repo.full_name;
      graph.meta.repo = repo.full_name;
      for (const node of graph.nodes) {
        if (node.name === path.basename(tmpDir) || node.id === "root") {
          node.name = repoName;
          node.id = repoName;
        }
      }
      // Fix edges that referenced old node id
      for (const edge of graph.edges) {
        if (edge.from === "root") edge.from = repoName;
        if (edge.to === "root") edge.to = repoName;
      }

      const { data: snapshot } = await db.from("graph_snapshots").insert({
        repo_id: repoId,
        node_count: graph.nodes.length,
        edge_count: graph.edges.length,
        total_files: graph.meta.total_files,
        language_breakdown: graph.meta.language_breakdown,
        raw_json: graph,
        commit_sha: commitSha,
        branch: repo.default_branch,
      }).select("id").single();

      await db.from("repos").update({ last_scanned_at: new Date().toISOString() }).eq("id", repoId);
      await db.from("scan_logs").update({ status: "completed", completed_at: new Date().toISOString(), snapshot_id: snapshot?.id }).eq("id", scanLogId);

      console.log(`[scan] Done: ${repo.full_name} — ${graph.nodes.length} services, ${graph.edges.length} edges`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err: any) {
    await db.from("scan_logs").update({ status: "failed", error_message: err.message, completed_at: new Date().toISOString() }).eq("id", scanLogId);
    throw err;
  }
}
