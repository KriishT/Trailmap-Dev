import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { supabaseAdmin } from "./supabase-server";
import { buildPrImpactAnalysis, type PrImpactAnalysis } from "./graph-impact";
import { matchOwnersForPath, parseCodeowners, type CodeownersRule } from "./codeowners";

const TRAILMAP_PR_COMMENT_MARKER = "<!-- trailmap-pr-impact -->";

interface RepoImpactContext {
  repoId: string;
  fullName: string;
  defaultBranch: string;
  installationId: number;
  snapshotId: string;
  snapshotCommit: string | null;
  graph: any;
}

export async function getRepoImpactContext(repoId: string): Promise<
  | { ok: true; context: RepoImpactContext }
  | { ok: false; error: string; status: number }
> {
  const db = supabaseAdmin();

  const { data: repo } = await db
    .from("repos")
    .select("id, full_name, default_branch, org_id")
    .eq("id", repoId)
    .single();

  if (!repo) return { ok: false, error: "Repo not found", status: 404 };

  const { data: org } = await db
    .from("organizations")
    .select("github_installation_id")
    .eq("id", repo.org_id)
    .single();

  if (!org?.github_installation_id) {
    return { ok: false, error: "No GitHub installation found for this repo", status: 400 };
  }

  const { data: snapshot } = await db
    .from("graph_snapshots")
    .select("id, raw_json, scanned_at, commit_sha")
    .eq("repo_id", repoId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .single();

  if (!snapshot) {
    return { ok: false, error: "No graph snapshot found for this repo", status: 404 };
  }

  return {
    ok: true,
    context: {
      repoId: repo.id,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      installationId: org.github_installation_id,
      snapshotId: snapshot.id,
      snapshotCommit: snapshot.commit_sha,
      graph: snapshot.raw_json,
    },
  };
}

export function createInstallationOctokit(installationId: number) {
  const appId = process.env.GITHUB_APP_ID!;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}

export async function getChangedFilesForImpact({
  octokit,
  fullName,
  defaultBranch,
  prNumber,
  base,
  head,
}: {
  octokit: Octokit;
  fullName: string;
  defaultBranch: string;
  prNumber?: number | null;
  base?: string | null;
  head?: string | null;
}): Promise<{ ok: true; files: string[]; source: string } | { ok: false; error: string; status: number }> {
  const [owner, repo] = fullName.split("/");

  try {
    if (typeof prNumber === "number") {
      const { data } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      return {
        ok: true,
        files: data.map((file) => file.filename),
        source: `pr:${prNumber}`,
      };
    }

    if (!(base && head)) {
      return { ok: false, error: "Provide either a PR number or both base/head commits", status: 400 };
    }

    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
      per_page: 100,
    });

    return {
      ok: true,
      files: (data.files ?? []).map((file) => file.filename),
      source: `compare:${base ?? defaultBranch}...${head ?? defaultBranch}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load changed files from GitHub";
    return { ok: false, error: message, status: 500 };
  }
}

async function getCodeownersRulesForRepo({
  octokit,
  fullName,
  ref,
}: {
  octokit: Octokit;
  fullName: string;
  ref?: string | null;
}): Promise<CodeownersRule[]> {
  const [owner, repo] = fullName.split("/");
  const candidatePaths = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

  for (const path of candidatePaths) {
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ...(ref ? { ref } : {}),
      });

      if (!("content" in data) || !data.content) continue;
      const content = Buffer.from(data.content, "base64").toString("utf8");
      const rules = parseCodeowners(content);
      if (rules.length > 0) return rules;
    } catch {
      continue;
    }
  }

  return [];
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function buildOwnershipMap(filePaths: string[], rules: CodeownersRule[]) {
  const ownership = new Map<string, string[]>();
  for (const filePath of filePaths) {
    ownership.set(normalizePath(filePath), matchOwnersForPath(filePath, rules));
  }
  return ownership;
}

export async function computePrImpactForRepo({
  repoId,
  prNumber,
  base,
  head,
}: {
  repoId: string;
  prNumber?: number | null;
  base?: string | null;
  head?: string | null;
}): Promise<
  | {
      ok: true;
      fullName: string;
      snapshotId: string;
      snapshotCommit: string | null;
      source: string;
      analysis: PrImpactAnalysis;
      installationId: number;
      prNumber?: number | null;
    }
  | { ok: false; error: string; status: number }
> {
  const contextResult = await getRepoImpactContext(repoId);
  if (!contextResult.ok) return contextResult;

  const { context } = contextResult;
  const octokit = createInstallationOctokit(context.installationId);
  const changedFiles = await getChangedFilesForImpact({
    octokit,
    fullName: context.fullName,
    defaultBranch: context.defaultBranch,
    prNumber,
    base,
    head,
  });

  if (!changedFiles.ok) return changedFiles;

  const codeownersRules = await getCodeownersRulesForRepo({
    octokit,
    fullName: context.fullName,
    ref: head ?? context.snapshotCommit ?? context.defaultBranch,
  });
  const ownershipByPath = buildOwnershipMap(changedFiles.files, codeownersRules);

  return {
    ok: true,
    fullName: context.fullName,
    snapshotId: context.snapshotId,
    snapshotCommit: context.snapshotCommit,
    source: changedFiles.source,
    analysis: buildPrImpactAnalysis(context.graph, changedFiles.files, ownershipByPath),
    installationId: context.installationId,
    prNumber,
  };
}

export function buildPrImpactComment(args: {
  source: string;
  snapshotCommit: string | null;
  analysis: PrImpactAnalysis;
  trailmapUrl?: string | null;
  repoId?: string | null;
}) {
  const { source, snapshotCommit, analysis, trailmapUrl, repoId } = args;
  const lines: string[] = [TRAILMAP_PR_COMMENT_MARKER, "## Trailmap Impact", "", analysis.summary, ""];

  lines.push(`- Source: \`${source}\``);
  if (snapshotCommit) lines.push(`- Snapshot commit: \`${snapshotCommit.slice(0, 7)}\``);
  lines.push(`- Changed files: ${analysis.changedFiles.length}`);
  lines.push(`- Touched services: ${analysis.touchedServices.length}`);
  lines.push(`- Unmatched files: ${analysis.unmatchedFiles.length}`);
  lines.push("");

  if (analysis.touchedServices.length > 0) {
    lines.push("### Touched Services");
    for (const service of analysis.touchedServices.slice(0, 6)) {
      const ownerText = service.owners.length > 0 ? ` · owners ${service.owners.join(", ")}` : "";
      lines.push(`- **${service.name}** · risk ${service.riskLevel} · blast radius ${service.blastRadius}${ownerText}`);
    }
    lines.push("");
  }

  if (analysis.suggestedReviewers.length > 0) {
    lines.push("### Suggested Reviewers");
    lines.push(`- ${analysis.suggestedReviewers.join(", ")}`);
    lines.push("");
  }

  if (
    analysis.affectedVendors.length > 0 ||
    analysis.affectedDataStores.length > 0 ||
    analysis.affectedDependents.length > 0
  ) {
    lines.push("### Downstream Surface");
    if (analysis.affectedVendors.length > 0) lines.push(`- Vendors: ${analysis.affectedVendors.slice(0, 8).join(", ")}`);
    if (analysis.affectedDataStores.length > 0) lines.push(`- Data stores: ${analysis.affectedDataStores.slice(0, 8).join(", ")}`);
    if (analysis.affectedDependents.length > 0) lines.push(`- Dependent services: ${analysis.affectedDependents.slice(0, 8).join(", ")}`);
    lines.push("");
  }

  if (analysis.unmatchedFiles.length > 0) {
    lines.push("### Unmatched Files");
    for (const file of analysis.unmatchedFiles.slice(0, 8)) {
      lines.push(`- \`${file}\``);
    }
    if (analysis.unmatchedFiles.length > 8) {
      lines.push(`- and ${analysis.unmatchedFiles.length - 8} more`);
    }
    lines.push("");
  }

  if (trailmapUrl && repoId) {
    lines.push(`[Open Trailmap impact view](${trailmapUrl}/repos/${repoId})`);
  }

  return lines.join("\n");
}

export async function upsertPrImpactComment({
  installationId,
  fullName,
  prNumber,
  body,
}: {
  installationId: number;
  fullName: string;
  prNumber: number;
  body: string;
}): Promise<{ ok: true; commentId: number; updated: boolean } | { ok: false; error: string; status: number }> {
  const [owner, repo] = fullName.split("/");
  const octokit = createInstallationOctokit(installationId);

  try {
    const { data: comments } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });

    const existing = comments.find((comment) => comment.body?.includes(TRAILMAP_PR_COMMENT_MARKER));
    if (existing) {
      const { data: updated } = await octokit.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body,
      });

      return { ok: true, commentId: updated.id, updated: true };
    }

    const { data: created } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });

    return { ok: true, commentId: created.id, updated: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not post Trailmap PR comment";
    return { ok: false, error: message, status: 500 };
  }
}

