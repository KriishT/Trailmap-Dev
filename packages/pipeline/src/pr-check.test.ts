import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scan } from "@trailmap/scanner";
import { createTestDb, ids, seedTwoOrgs, type TestDb } from "../../../supabase/tests/db";
import { adminClient } from "../../../supabase/tests/pg-client";
import { runPrCheck, runPrRecheck } from "./pr-check";
import { processNextJob } from "./scan-job";
import { PR_COMMENT_MARKER } from "./pr-comment";
import type { CheckConclusion, GithubPort, PipelineDeps, TempDir } from "./types";

const TOKEN = "ghs_PRCHECKTOKEN";

const BASE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "billing", scripts: { start: "node src/index.js" }, dependencies: { pg: "^8" } }),
  "src/index.ts": 'import { Pool } from "pg";\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\npool.query("select 1");\n',
  "CODEOWNERS": "src/ @payments-team\n",
};
const STRIPE_FILE = 'import Stripe from "stripe";\nconst s = new Stripe(process.env.STRIPE_SECRET_KEY as string);\ns.paymentIntents.create({ amount: 1 });\n';

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;
let tempDirs: string[];
let headFiles: Record<string, string>;
let calls: { checks: Array<{ conclusion: CheckConclusion; title: string; summary: string; text: string }>; updates: Array<{ conclusion: CheckConclusion; title: string }>; comments: string[] };
let changedFiles: string[];

const writeFiles = (dir: string, files: Record<string, string>) => {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
};

const github: GithubPort = {
  getCloneAccess: async () => ({ token: TOKEN, headSha: "basesha" }),
  getPullRequest: async ({ prNumber }) => ({ number: prNumber, headSha: "headsha1", baseRef: "main", headRef: "feature", title: "t", state: "open" }),
  listPullRequestFiles: async () => changedFiles,
  createCheckRun: async (a) => { calls.checks.push(a); return { id: 900 + calls.checks.length }; },
  updateCheckRun: async (a) => { calls.updates.push(a); },
  upsertPullRequestComment: async (a) => { expect(a.marker).toBe(PR_COMMENT_MARKER); calls.comments.push(a.body); return { id: 55 }; },
};

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    db: adminClient(db) as never,
    github,
    cloner: async ({ dir, ref }) => {
      expect(ref).toBe("refs/pull/7/head");
      writeFiles(dir, headFiles);
    },
    tempDir: (): TempDir => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-prcheck-"));
      tempDirs.push(dir);
      return { path: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    },
    scan,
    appUrl: "https://app.example.test",
    ...overrides,
  };
}

async function snapshotOf(files: Record<string, string>): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-base-"));
  try {
    writeFiles(dir, files);
    const graph = await scan({ rootDir: dir, repoName: "org-a/a", scannedAt: "2026-01-01T00:00:00.000Z" });
    return (await db.admin<{ id: string }>(
      `INSERT INTO graph_snapshots (repo_id, raw_json, node_count, edge_count) VALUES ($1, $2, $3, $4) RETURNING id`,
      [s.repoA, JSON.stringify(graph), graph.nodes.length, graph.edges.length]
    ))[0]!.id;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function queuePrCheck(): Promise<string> {
  return (await db.admin<{ id: string }>(
    `INSERT INTO scan_logs (repo_id, triggered_by, kind, payload) VALUES ($1, 'webhook', 'pr_check', '{"prNumber":7}') RETURNING id`,
    [s.repoA]
  ))[0]!.id;
}

const event = async () => (await db.admin<Record<string, unknown>>(`SELECT * FROM drift_events WHERE repo_id = $1 AND pr_number = 7`, [s.repoA]))[0]!;

beforeAll(async () => {
  db = await createTestDb();
  s = await seedTwoOrgs(db);
  await db.admin(`UPDATE organizations SET github_installation_id = 4242 WHERE id = $1`, [s.orgA]);
});
afterAll(async () => {
  await db.pg.close();
});
beforeEach(async () => {
  tempDirs = [];
  calls = { checks: [], updates: [], comments: [] };
  changedFiles = ["src/index.ts"];
  headFiles = { ...BASE_FILES };
  for (const t of ["scan_logs", "drift_events", "graph_snapshots", "scope_members", "scopes", "graph_overrides", "repo_policies"]) {
    if (t === "graph_snapshots") await db.admin(`DELETE FROM graph_snapshots WHERE repo_id = $1`, [s.repoA]);
    else if (t === "drift_events") await db.admin(`DELETE FROM drift_events`);
    else await db.admin(`DELETE FROM ${t}`);
  }
});

describe("runPrCheck", () => {
  it("fails the check when a PR brings in a new vendor across a scope boundary, and explains how to accept it", async () => {
    await snapshotOf(BASE_FILES);
    const scope = (await db.admin<{ id: string }>(`INSERT INTO scopes (repo_id, name, created_by) VALUES ($1, 'PCI CDE', $2) RETURNING id`, [s.repoA, ids.userA]))[0]!.id;
    await db.admin(`INSERT INTO scope_members (scope_id, node_id) VALUES ($1, 'service:.'), ($1, 'db:postgres')`, [scope]);
    headFiles = { ...BASE_FILES, "src/pay.ts": STRIPE_FILE, ".trailmap.yml": "on_drift: failure\n" };
    changedFiles = ["src/pay.ts", "src/index.ts"];
    const logId = await queuePrCheck();

    const out = await processNextJob(makeDeps());

    expect(out).toMatchObject({ status: "completed", conclusion: "failure" });
    expect(calls.checks).toHaveLength(1);
    expect(calls.checks[0]!.conclusion).toBe("failure");
    expect(calls.checks[0]!.title).toMatch(/scope drift/);
    const body = calls.comments[0]!;
    expect(body).toContain("New third-party vendor: Stripe");
    expect(body).toContain("crosses the \"PCI CDE\" boundary");
    expect(body).toMatch(/\[`src\/pay\.ts:1`\]\(https:\/\/github\.com\/org-a\/a\/blob\/headsha1\/src\/pay\.ts#L1\)/);
    expect(body).toContain("/trailmap ack");
    expect(body).toContain("<details>");
    expect(body).toContain("@payments-team");
    expect(body).toContain("https://app.example.test/repos/");
    expect(body).not.toMatch(/sk_|ghs_/);

    const ev = await event();
    expect(ev).toMatchObject({ pr_number: 7, head_sha: "headsha1", conclusion: "failure", status: "open", check_run_id: 901, comment_id: 55 });
    expect((ev.findings as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(String(ev.head_graph_hash)).toHaveLength(64);
    expect((await db.admin<{ status: string }>(`SELECT status FROM scan_logs WHERE id = $1`, [logId]))[0]!.status).toBe("completed");
    expect(tempDirs.every((d) => !fs.existsSync(d))).toBe(true);
  });

  it("passes when the PR changes nothing architectural", async () => {
    await snapshotOf(BASE_FILES);
    await queuePrCheck();
    const out = await processNextJob(makeDeps());
    expect(out).toMatchObject({ conclusion: "success" });
    expect(calls.checks[0]!.title).toBe("No scope drift detected.");
    expect(calls.comments[0]).not.toContain("/trailmap ack");
  });

  it("uses the neutral conclusion by default (no .trailmap.yml)", async () => {
    await snapshotOf(BASE_FILES);
    headFiles = { ...BASE_FILES, "src/pay.ts": STRIPE_FILE };
    await queuePrCheck();
    expect(await processNextJob(makeDeps())).toMatchObject({ conclusion: "neutral" });
  });

  it("reports there is nothing to compare against when no snapshot exists", async () => {
    await queuePrCheck();
    const out = await processNextJob(makeDeps());
    expect(out).toMatchObject({ conclusion: "neutral" });
    expect(calls.comments[0]).toContain("No baseline snapshot");
  });

  it("treats an unreadable baseline snapshot as no baseline and says so", async () => {
    await db.admin(`INSERT INTO graph_snapshots (repo_id, raw_json) VALUES ($1, '{"nodes":"garbage"}')`, [s.repoA]);
    await queuePrCheck();
    expect(await processNextJob(makeDeps())).toMatchObject({ conclusion: "neutral" });
    expect(calls.comments[0]).toContain("could not be read");
  });

  it("applies the ignore list and disabled rules from the policy, and reports bad policy files", async () => {
    await snapshotOf(BASE_FILES);
    headFiles = { ...BASE_FILES, "src/pay.ts": STRIPE_FILE, ".trailmap.yml": "on_drift: failure\nignore:\n  - vendor:stripe\n" };
    await queuePrCheck();
    expect(await processNextJob(makeDeps())).toMatchObject({ conclusion: "success" });
    expect(calls.comments[0]).toContain("accepted by `.trailmap.yml`");

    await db.admin(`DELETE FROM scan_logs`);
    await db.admin(`DELETE FROM drift_events`);
    headFiles = { ...BASE_FILES, ".trailmap.yml": "on_drift: explode\n" };
    await queuePrCheck();
    await processNextJob(makeDeps());
    expect(calls.comments.at(-1)).toContain("Policy problems");
  });

  it("settings made in the app override the repository file", async () => {
    await snapshotOf(BASE_FILES);
    await db.admin(`INSERT INTO repo_policies (repo_id, config, updated_by) VALUES ($1, '{"on_drift":"failure"}', $2)`, [s.repoA, ids.userA]);
    headFiles = { ...BASE_FILES, "src/pay.ts": STRIPE_FILE, ".trailmap.yml": "on_drift: neutral\n" };
    await queuePrCheck();
    expect(await processNextJob(makeDeps())).toMatchObject({ conclusion: "failure" });
  });

  it("does not count an edge a person hid as drift", async () => {
    await snapshotOf(BASE_FILES);
    headFiles = { ...BASE_FILES, "src/pay.ts": STRIPE_FILE, ".trailmap.yml": "on_drift: failure\n" };
    await db.admin(`INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'hide_node', '{"nodeId":"vendor:stripe"}', 'handled elsewhere', $2)`, [s.repoA, ids.userA]);
    await queuePrCheck();
    expect(await processNextJob(makeDeps())).toMatchObject({ conclusion: "success" });
  });

  it("deletes the clone and redacts the token when the clone fails", async () => {
    await snapshotOf(BASE_FILES);
    const logId = await queuePrCheck();
    const out = await processNextJob(
      makeDeps({ cloner: async ({ url, dir }) => { fs.writeFileSync(path.join(dir, "x"), "1"); throw new Error(`fatal: could not read from ${url}`); } })
    );
    expect(out.status).toBe("failed");
    const log = (await db.admin<{ status: string; error_message: string }>(`SELECT status, error_message FROM scan_logs WHERE id = $1`, [logId]))[0]!;
    expect(log.status).toBe("failed");
    expect(log.error_message).not.toContain(TOKEN);
    expect(tempDirs.every((d) => !fs.existsSync(d))).toBe(true);
    expect(calls.checks).toHaveLength(0);
  });

  it("rejects a job with no PR number", async () => {
    const logId = (await db.admin<{ id: string }>(`INSERT INTO scan_logs (repo_id, triggered_by, kind, payload) VALUES ($1, 'webhook', 'pr_check', '{}') RETURNING id`, [s.repoA]))[0]!.id;
    const out = await processNextJob(makeDeps());
    expect(out).toMatchObject({ status: "failed", scanLogId: logId });
  });
});

describe("acknowledge and re-check", () => {
  async function failingCheck(): Promise<string> {
    await snapshotOf(BASE_FILES);
    headFiles = { ...BASE_FILES, "src/pay.ts": STRIPE_FILE, ".trailmap.yml": "on_drift: failure\n" };
    await queuePrCheck();
    const out = await processNextJob(makeDeps());
    expect(out).toMatchObject({ conclusion: "failure" });
    return (await event()).id as string;
  }
  const queueRecheck = async (driftEventId: string) =>
    (await db.admin<{ id: string }>(`INSERT INTO scan_logs (repo_id, triggered_by, kind, payload) VALUES ($1, 'webhook', 'pr_recheck', $2) RETURNING id`, [s.repoA, JSON.stringify({ driftEventId })]))[0]!.id;

  it("turns the check green once an attestation for this exact graph exists", async () => {
    const id = await failingCheck();
    const hash = String((await event()).head_graph_hash);
    await db.admin(`INSERT INTO attestations (repo_id, kind, graph_hash, drift_event_id, actor_user_id, actor_label, note) VALUES ($1, 'drift_ack', $2, $3, $4, 'kay@acme.io', 'accepted risk')`, [s.repoA, hash, id, ids.userA]);
    await queueRecheck(id);

    const out = await processNextJob(makeDeps());

    expect(out).toMatchObject({ status: "completed", conclusion: "success" });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({ conclusion: "success", title: "Acknowledged by kay@acme.io" });
    expect(calls.comments.at(-1)).toContain("acknowledged by kay@acme.io");
    expect(await event()).toMatchObject({ status: "acknowledged", conclusion: "success", acknowledged_by: "kay@acme.io" });
  });

  it("refuses an acknowledgement made for a different graph (an earlier push)", async () => {
    const id = await failingCheck();
    await db.admin(`INSERT INTO attestations (repo_id, kind, graph_hash, drift_event_id, actor_user_id, actor_label) VALUES ($1, 'drift_ack', $2, $3, $4, 'kay@acme.io')`, [s.repoA, "f".repeat(64), id, ids.userA]);
    await queueRecheck(id);
    const out = await processNextJob(makeDeps());
    expect(out.status).toBe("failed");
    expect(calls.updates).toHaveLength(0);
    expect(await event()).toMatchObject({ status: "open", conclusion: "failure" });
  });

  it("refuses a re-check when nobody acknowledged", async () => {
    const id = await failingCheck();
    await queueRecheck(id);
    expect((await processNextJob(makeDeps())).status).toBe("failed");
  });

  it("keeps an acknowledged commit green when the same commit is checked again, but not a new push", async () => {
    const id = await failingCheck();
    const hash = String((await event()).head_graph_hash);
    await db.admin(`INSERT INTO attestations (repo_id, kind, graph_hash, drift_event_id, actor_user_id, actor_label) VALUES ($1, 'drift_ack', $2, $3, $4, 'kay@acme.io')`, [s.repoA, hash, id, ids.userA]);
    await queueRecheck(id);
    await processNextJob(makeDeps());

    await queuePrCheck();
    expect(await processNextJob(makeDeps())).toMatchObject({ conclusion: "success" });
    expect(calls.checks.at(-1)!.title).toBe("Acknowledged by kay@acme.io");

    headFiles = { ...headFiles, "src/other.ts": 'import twilio from "twilio";\ntwilio(process.env.TWILIO_ACCOUNT_SID);\n' };
    const prev = github.getPullRequest;
    github.getPullRequest = async (a) => ({ ...(await prev(a)), headSha: "headsha2" });
    try {
      await queuePrCheck();
      expect(await processNextJob(makeDeps())).toMatchObject({ conclusion: "failure" });
    } finally {
      github.getPullRequest = prev;
    }
  });

  it("fails cleanly for an unknown drift event", async () => {
    await queueRecheck("00000000-0000-0000-0000-000000000000");
    expect((await runPrRecheck({ scanLogId: "x", repoId: s.repoA, kind: "pr_recheck", payload: { driftEventId: "00000000-0000-0000-0000-000000000000" } }, makeDeps())).status).toBe("failed");
    expect(runPrCheck).toBeTypeOf("function");
  });
});
