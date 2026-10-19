import * as fs from "node:fs";
import * as path from "node:path";
import type { Cloner, GithubPort } from "@trailmap/pipeline";
import { demoPullRequestFiles, demoRevisionFiles } from "./demo/build";

/** The repositories the mocked GitHub App installation can see, and which fixture each one clones from. */
export const LOCAL_GITHUB_REPOS = [
  { id: 1001, name: "shop", full_name: "acme/shop", private: true, default_branch: "main", source: "demo" },
  { id: 3001, name: "billing-api", full_name: "acme/billing-api", private: true, default_branch: "main", source: "python-fastapi" },
  { id: 3002, name: "notifier", full_name: "acme/notifier", private: false, default_branch: "main", source: "go-kafka-redis" },
  { id: 3003, name: "platform-infra", full_name: "acme/platform-infra", private: true, default_branch: "main", source: "terraform-aws" },
] as const;

export interface LocalCheckRun {
  id: number;
  fullName: string;
  headSha: string;
  name: string;
  conclusion: string;
  title: string;
  summary: string;
  text: string;
  updates: number;
}

export interface LocalGithubStore {
  nextId: number;
  checkRuns: LocalCheckRun[];
  comments: Array<{ id: number; fullName: string; prNumber: number; body: string; edits: number }>;
}

const g = globalThis as { __trailmapGithub?: LocalGithubStore };
export const githubStore = (): LocalGithubStore => (g.__trailmapGithub ??= { nextId: 1000, checkRuns: [], comments: [] });
export const resetGithubStore = () => { g.__trailmapGithub = { nextId: 1000, checkRuns: [], comments: [] }; };

const PR_FILES = ["services/gateway/src/index.ts", "services/gateway/package.json", "docker-compose.yml"];

export const localGithubPort: GithubPort = {
  async getCloneAccess({ fullName }) {
    const latest = demoRevisionFiles().at(-1)!;
    return { token: `local-token-for-${fullName}`, headSha: latest.commit };
  },
  async getPullRequest({ fullName, prNumber }) {
    if (fullName !== "acme/shop" || prNumber !== 12) throw new Error(`Pull request ${fullName}#${prNumber} not found in the local GitHub`);
    return { number: 12, headSha: "9c1d2e3f4a5b", baseRef: "main", headRef: "mixpanel-tracking", title: "Track order list views in Mixpanel", state: "open" };
  },
  async listPullRequestFiles() {
    return PR_FILES;
  },
  async createCheckRun(a) {
    const s = githubStore();
    const run: LocalCheckRun = { id: ++s.nextId, fullName: a.fullName, headSha: a.headSha, name: a.name, conclusion: a.conclusion, title: a.title, summary: a.summary, text: a.text, updates: 0 };
    s.checkRuns.push(run);
    return { id: run.id };
  },
  async updateCheckRun(a) {
    const run = githubStore().checkRuns.find((r) => r.id === a.checkRunId);
    if (!run) throw new Error("Check run not found");
    Object.assign(run, { conclusion: a.conclusion, title: a.title, summary: a.summary, text: a.text, updates: run.updates + 1 });
  },
  async upsertPullRequestComment(a) {
    const s = githubStore();
    const mine = s.comments.find((c) => c.fullName === a.fullName && c.prNumber === a.prNumber && c.body.includes(a.marker));
    if (mine) { mine.body = a.body; mine.edits++; return { id: mine.id }; }
    const c = { id: ++s.nextId, fullName: a.fullName, prNumber: a.prNumber, body: a.body, edits: 0 };
    s.comments.push(c);
    return { id: c.id };
  },
};

function writeTree(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

function fixtureDir(name: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "packages", "scanner", "fixtures", name, "repo");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Fixture ${name} not found`);
}

/** "Clone" from the demo repository or a scanner fixture instead of from GitHub. */
export const localCloner: Cloner = async ({ url, dir, ref }) => {
  const fullName = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1];
  if (ref === "refs/pull/12/head") return writeTree(dir, demoPullRequestFiles());
  const repo = LOCAL_GITHUB_REPOS.find((r) => r.full_name === fullName);
  if (!repo) throw new Error(`Repository ${fullName ?? url} not found in the local GitHub`);
  if (repo.source === "demo") return writeTree(dir, demoRevisionFiles().at(-1)!.files);
  fs.cpSync(fixtureDir(repo.source), dir, { recursive: true });
};
