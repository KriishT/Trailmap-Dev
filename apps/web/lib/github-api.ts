import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { GithubApi, RepoPermission } from "./github-events";
import { isLocalMode } from "./local-mode";

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

const realGithubApi: GithubApi = {
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

/** Local mode: the mocked GitHub knows three people, two of whom may write. */
const localGithubApi: GithubApi = {
  async getDefaultBranch() {
    return "main";
  },
  async getPermission(_installationId, _fullName, login): Promise<RepoPermission> {
    if (login === "kay" || login === "lee") return "write";
    return login === "mia" ? "read" : "none";
  },
};

/** GitHub client used by the webhook handler: the real App in production, a mock in local mode. */
export const githubApi: GithubApi = {
  getDefaultBranch: (i, f) => (isLocalMode() ? localGithubApi : realGithubApi).getDefaultBranch(i, f),
  getPermission: (i, f, l) => (isLocalMode() ? localGithubApi : realGithubApi).getPermission(i, f, l),
};
