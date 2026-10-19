import { createInstallationOctokit } from "./github-pr-impact";
import type { GithubApi } from "./github-events";

/** Production GitHub client used by the webhook handler. */
export const githubApi: GithubApi = {
  async getDefaultBranch(installationId, fullName) {
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) throw new Error(`Invalid repo name: ${fullName}`);
    const octokit = createInstallationOctokit(installationId);
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch;
  },
};
