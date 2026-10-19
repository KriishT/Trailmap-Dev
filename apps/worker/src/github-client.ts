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

export const githubPort: GithubPort = {
  async getCloneAccess({ installationId, fullName, branch }) {
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) throw new Error(`Invalid repo name: ${fullName}`);

    const octokit = getInstallationOctokit(installationId);
    const { data: head } = await octokit.repos.getBranch({ owner, repo, branch });
    const { data: access } = await octokit.apps.createInstallationAccessToken({
      installation_id: installationId,
      repositories: [repo],
      permissions: { contents: "read", metadata: "read" },
    });
    return { token: access.token, headSha: head.commit.sha };
  },
};
