import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export function getInstallationOctokit(installationId: number): Octokit {
  const appId = process.env.GITHUB_APP_ID!;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}
