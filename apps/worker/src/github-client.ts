import { Octokit } from "@octokit/rest";

export function getOctokit(githubToken: string): Octokit {
  return new Octokit({ auth: githubToken });
}
