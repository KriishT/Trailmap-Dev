import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "@trailmap/scanner";
import {
  evaluateDrift, mergePolicy, parsePolicy, type DependencyGraph, type DriftResult, type Scope,
} from "@trailmap/graph";
import { plural } from "./format.js";

export interface CheckOptions {
  dir: string;
  /** Git ref to compare against, for example `origin/main`. */
  base: string;
  /** Path to a policy file. Defaults to `.trailmap.yml` in `dir`. */
  policyFile?: string;
  exclude?: string[];
}

export interface CheckResult {
  drift: DriftResult;
  base: DependencyGraph;
  head: DependencyGraph;
  policyErrors: string[];
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function readPolicyText(dir: string, policyFile?: string): string | null {
  const candidates = policyFile ? [path.resolve(policyFile)] : [path.join(dir, ".trailmap.yml"), path.join(dir, ".trailmap.yaml")];
  for (const c of candidates) {
    try {
      return fs.readFileSync(c, "utf8");
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Compare the working tree with a git ref, entirely locally. No network, no upload. */
export async function runLocalCheck(opts: CheckOptions): Promise<CheckResult> {
  const dir = path.resolve(opts.dir);
  try {
    git(dir, ["rev-parse", "--verify", `${opts.base}^{commit}`]);
  } catch {
    throw new Error(`Cannot find git ref "${opts.base}". In CI, fetch it first (for example: git fetch origin main --depth=1).`);
  }

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-base-"));
  fs.rmSync(worktree, { recursive: true, force: true });
  try {
    git(dir, ["worktree", "add", "--detach", worktree, opts.base]);
    const repoName = path.basename(dir);
    const [base, head] = await Promise.all([
      scan({ rootDir: worktree, repoName, exclude: opts.exclude, scannedAt: "1970-01-01T00:00:00.000Z" }),
      scan({ rootDir: dir, repoName, exclude: opts.exclude, scannedAt: "1970-01-01T00:00:00.000Z" }),
    ]);

    const parsed = parsePolicy(readPolicyText(dir, opts.policyFile));
    const policy = mergePolicy(parsed.policy, null);
    const scopes: Scope[] = policy.scopes.map((s) => ({ id: `policy:${s.name}`, name: s.name, nodeIds: s.nodes }));
    return { drift: evaluateDrift({ base, head, scopes, policy }), base, head, policyErrors: parsed.errors };
  } finally {
    try {
      git(dir, ["worktree", "remove", "--force", worktree]);
    } catch {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
}

export function renderDriftReport(r: Pick<DriftResult, "findings" | "ignored" | "conclusion" | "summary">, policyErrors: string[] = []): string {
  const lines: string[] = [];
  lines.push(`Trailmap scope check: ${r.conclusion}`, r.summary, "");
  for (const f of r.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.title}`, `  ${f.detail}`);
    const ev = f.evidence.find((e) => e.line) ?? f.evidence[0];
    if (ev) lines.push(`  evidence: ${ev.source}${ev.line ? `:${ev.line}` : ""}`);
    lines.push("");
  }
  if (r.ignored.length) lines.push(`${plural(r.ignored.length, "finding")} accepted by .trailmap.yml and not shown.`, "");
  for (const e of policyErrors) lines.push(`policy: ${e}`);
  return lines.join("\n").trimEnd() + "\n";
}
