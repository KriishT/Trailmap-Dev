import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { GithubPort } from "@trailmap/pipeline";

export function getInstallationOctokit(installationId: number): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !rawKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set");
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey: rawKey.replace(/\\n/g, "\n"), installationId },
  });
}

function split(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo name: ${fullName}`);
  return { owner, repo };
}

// GitHub caps check-run text fields at 65,535 characters.
const clip = (s: string, max = 60000) => (s.length > max ? s.slice(0, max - 20) + "\n\n(truncated)" : s);

export const githubPort: GithubPort = {
  async getCloneAccess({ installationId, fullName, branch }) {
    const { owner, repo } = split(fullName);
    const octokit = getInstallationOctokit(installationId);
    const { data: head } = await octokit.repos.getBranch({ owner, repo, branch });
    const { data: access } = await octokit.apps.createInstallationAccessToken({
      installation_id: installationId,
      repositories: [repo],
      permissions: { contents: "read", metadata: "read" },
    });
    return { token: access.token, headSha: head.commit.sha };
  },

  async getPullRequest({ installationId, fullName, prNumber }) {
    const { owner, repo } = split(fullName);
    const { data } = await getInstallationOctokit(installationId).pulls.get({ owner, repo, pull_number: prNumber });
    return { number: data.number, headSha: data.head.sha, baseRef: data.base.ref, headRef: data.head.ref, title: data.title, state: data.state };
  },

  async listPullRequestFiles({ installationId, fullName, prNumber }) {
    const { owner, repo } = split(fullName);
    const octokit = getInstallationOctokit(installationId);
    const files = await octokit.paginate(octokit.pulls.listFiles, { owner, repo, pull_number: prNumber, per_page: 100 });
    return files.map((f) => f.filename);
  },

  async createCheckRun({ installationId, fullName, headSha, name, conclusion, title, summary, text }) {
    const { owner, repo } = split(fullName);
    const { data } = await getInstallationOctokit(installationId).checks.create({
      owner, repo, name, head_sha: headSha, status: "completed", conclusion,
      output: { title: clip(title, 250), summary: clip(summary), text: clip(text) },
    });
    return { id: data.id };
  },

  async updateCheckRun({ installationId, fullName, checkRunId, conclusion, title, summary, text }) {
    const { owner, repo } = split(fullName);
    await getInstallationOctokit(installationId).checks.update({
      owner, repo, check_run_id: checkRunId, status: "completed", conclusion,
      output: { title: clip(title, 250), summary: clip(summary), text: clip(text) },
    });
  },

  async upsertPullRequestComment({ installationId, fullName, prNumber, marker, body }) {
    const { owner, repo } = split(fullName);
    const octokit = getInstallationOctokit(installationId);
    const comments = await octokit.paginate(octokit.issues.listComments, { owner, repo, issue_number: prNumber, per_page: 100 });
    const mine = comments.find((c) => c.body?.includes(marker));
    if (mine) {
      const { data } = await octokit.issues.updateComment({ owner, repo, comment_id: mine.id, body });
      return { id: data.id };
    }
    const { data } = await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
    return { id: data.id };
  },
};
