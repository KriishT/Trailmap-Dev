import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { GithubApi, RepoPermission } from "./github-events";

function installationOctokit(installationId: number) {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !rawKey) throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set");
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey: rawKey.replace(/\\n/g, "\n"), installationId },
  });
}

function split(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo name: ${fullName}`);
  return { owner, repo };
}

/** Production GitHub client used by the webhook handler. */
export const githubApi: GithubApi = {
  async getDefaultBranch(installationId, fullName) {
    const { data } = await installationOctokit(installationId).repos.get(split(fullName));
    return data.default_branch;
  },

  async getPermission(installationId, fullName, login): Promise<RepoPermission> {
    try {
      const { data } = await installationOctokit(installationId).repos.getCollaboratorPermissionLevel({
        ...split(fullName),
        username: login,
      });
      return data.permission as RepoPermission;
    } catch {
      return "none";
    }
  },
};
