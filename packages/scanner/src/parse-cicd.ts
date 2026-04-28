import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface CiCdInfo {
  platform: "github-actions" | "circleci" | "jenkins" | "unknown";
  services: string[];
  environments: string[];
}

export function parseCiCdFile(filePath: string): CiCdInfo {
  const base = path.basename(filePath).toLowerCase();

  if (filePath.includes(".github/workflows")) {
    return parseGitHubActions(filePath);
  }
  if (base === "config.yml" && filePath.includes(".circleci")) {
    return parseCircleCi(filePath);
  }
  if (base === "jenkinsfile") {
    return parseJenkinsfile(filePath);
  }

  return { platform: "unknown", services: [], environments: [] };
}

function parseGitHubActions(filePath: string): CiCdInfo {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const doc = yaml.load(content) as Record<string, unknown>;
    const services: string[] = [];
    const environments: string[] = [];

    // Extract service container names
    const jobs = (doc?.jobs ?? {}) as Record<string, unknown>;
    for (const job of Object.values(jobs)) {
      const j = job as Record<string, unknown>;
      const serviceContainers = (j?.services ?? {}) as Record<string, unknown>;
      services.push(...Object.keys(serviceContainers));

      const env = (j?.environment as Record<string, unknown>) ?? {};
      if (env?.name) environments.push(env.name as string);
    }

    return { platform: "github-actions", services, environments };
  } catch {
    return { platform: "github-actions", services: [], environments: [] };
  }
}

function parseCircleCi(filePath: string): CiCdInfo {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const doc = yaml.load(content) as Record<string, unknown>;
    const services: string[] = [];

    const jobs = (doc?.jobs ?? {}) as Record<string, unknown>;
    for (const job of Object.values(jobs)) {
      const j = job as Record<string, unknown>;
      const docker = (j?.docker as Array<Record<string, unknown>>) ?? [];
      for (const container of docker.slice(1)) {
        if (container.image) services.push(container.image as string);
      }
    }

    return { platform: "circleci", services, environments: [] };
  } catch {
    return { platform: "circleci", services: [], environments: [] };
  }
}

function parseJenkinsfile(filePath: string): CiCdInfo {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const services: string[] = [];
    // Look for sh steps calling docker or service names
    const matches = content.matchAll(/docker\s+run\s+.*?([a-z0-9\-_]+:[a-z0-9.]+)/gi);
    for (const m of matches) {
      if (m[1]) services.push(m[1]);
    }
    return { platform: "jenkins", services, environments: [] };
  } catch {
    return { platform: "jenkins", services: [], environments: [] };
  }
}
