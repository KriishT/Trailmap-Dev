import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scan } from "@trailmap/scanner";
import { createTestDb, seedTwoOrgs, type TestDb } from "../../../supabase/tests/db";
import { adminClient } from "../../../supabase/tests/pg-client";
import { processNextJob } from "./scan-job";
import type { PipelineDeps, TempDir } from "./types";

const TOKEN = "ghs_SUPERSECRETINSTALLTOKEN";
const SOURCE_MARKER = "SOURCE_MARKER_DO_NOT_STORE_7f3a";

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;
let tempDirs: string[];
let seenScanOptions: Array<{ rootDir: string; repoName?: string }>;

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    db: adminClient(db) as never,
    github: {
      getCloneAccess: async () => ({ token: TOKEN, headSha: "abc123" }),
    },
    cloner: async ({ dir }) => {
      // Stand in for git clone: drop a tiny Node service into the temp dir.
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", dependencies: { express: "^4" } }));
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src", "index.ts"), `// ${SOURCE_MARKER}\nconsole.log("hi");\n`);
    },
    tempDir: (): TempDir => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-test-"));
      tempDirs.push(dir);
      return { path: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    },
    scan: async (options) => {
      seenScanOptions.push(options);
      return scan(options);
    },
    ...overrides,
  };
}

const logRow = async (id: string) =>
  (await db.admin<Record<string, unknown>>(`SELECT * FROM scan_logs WHERE id = $1`, [id]))[0]!;

async function queueScan(): Promise<string> {
  return (
    await db.admin<{ id: string }>(
      `INSERT INTO scan_logs (repo_id, triggered_by) VALUES ($1, 'manual') RETURNING id`,
      [s.repoA]
    )
  )[0]!.id;
}

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
  seenScanOptions = [];
  await db.admin(`DELETE FROM scan_logs`);
  await db.admin(`DELETE FROM graph_snapshots WHERE id <> $1 AND id <> $2`, [s.snapA, s.snapB]);
});

describe("processNextJob", () => {
  it("is idle when nothing is queued", async () => {
    expect(await processNextJob(makeDeps())).toEqual({ status: "idle" });
  });

  it("clones, scans, stores a versioned snapshot and completes the log", async () => {
    const logId = await queueScan();
    const outcome = await processNextJob(makeDeps());

    expect(outcome.status).toBe("completed");
    const log = await logRow(logId);
    expect(log.status).toBe("completed");
    expect(log.snapshot_id).toBeTruthy();

    const snap = (await db.admin<{ commit_sha: string; branch: string; raw_json: { meta: Record<string, unknown> } }>(
      `SELECT commit_sha, branch, raw_json FROM graph_snapshots WHERE id = $1`,
      [log.snapshot_id as string]
    ))[0]!;
    expect(snap.commit_sha).toBe("abc123");
    expect(snap.branch).toBe("main");
    expect(snap.raw_json.meta.graphSchemaVersion).toBe(1);
    expect(snap.raw_json.meta.repo).toBe("org-a/a");

    const repo = (await db.admin<{ last_scanned_at: string | null }>(`SELECT last_scanned_at FROM repos WHERE id = $1`, [s.repoA]))[0]!;
    expect(repo.last_scanned_at).not.toBeNull();
  });

  it("passes the real repo name to the scanner instead of renaming nodes afterwards", async () => {
    await queueScan();
    await processNextJob(makeDeps());
    expect(seenScanOptions[0]?.repoName).toBe("org-a/a");
  });

  it("deletes the temp clone after a successful scan", async () => {
    await queueScan();
    await processNextJob(makeDeps());
    expect(tempDirs).toHaveLength(1);
    expect(fs.existsSync(tempDirs[0]!)).toBe(false);
  });

  it("never stores source code or file contents", async () => {
    await queueScan();
    await processNextJob(makeDeps());
    const hits = await db.admin(`SELECT 1 FROM graph_snapshots WHERE raw_json::text LIKE $1`, [`%${SOURCE_MARKER}%`]);
    expect(hits).toHaveLength(0);
  });

  it("deletes the temp clone and records a redacted error when the clone fails", async () => {
    const logId = await queueScan();
    const outcome = await processNextJob(
      makeDeps({
        cloner: async ({ url, dir }) => {
          fs.writeFileSync(path.join(dir, "partial.txt"), "half a clone");
          throw new Error(`fatal: unable to access '${url}': connection reset`);
        },
      })
    );

    expect(outcome.status).toBe("failed");
    const log = await logRow(logId);
    expect(log.status).toBe("failed");
    expect(String(log.error_message)).not.toContain(TOKEN);
    expect(String(log.error_message)).toContain("***");
    expect(fs.existsSync(tempDirs[0]!)).toBe(false);
  });

  it("deletes the temp clone and saves nothing when the scanner returns an invalid graph", async () => {
    const logId = await queueScan();
    const before = await db.admin(`SELECT 1 FROM graph_snapshots`);
    const outcome = await processNextJob(
      makeDeps({
        scan: async () =>
          ({
            meta: { repo: "x", scanned_at: "now", language_breakdown: {}, total_files: 0 },
            nodes: [],
            edges: [{ from: "ghost", to: "ghost2", type: "http", confidence: "high" }],
          }) as never,
      })
    );

    expect(outcome.status).toBe("failed");
    expect((await logRow(logId)).status).toBe("failed");
    expect(await db.admin(`SELECT 1 FROM graph_snapshots`)).toHaveLength(before.length);
    expect(fs.existsSync(tempDirs[0]!)).toBe(false);
  });

  it("fails the job when the org has no GitHub installation", async () => {
    await db.admin(`UPDATE organizations SET github_installation_id = NULL WHERE id = $1`, [s.orgA]);
    const logId = await queueScan();
    const outcome = await processNextJob(makeDeps());
    await db.admin(`UPDATE organizations SET github_installation_id = 4242 WHERE id = $1`, [s.orgA]);
    expect(outcome.status).toBe("failed");
    expect(String((await logRow(logId)).error_message)).toMatch(/installation/i);
    expect(tempDirs).toHaveLength(0);
  });

  it("processes a single queued job exactly once when two workers race for it", async () => {
    await queueScan();
    const outcomes = await Promise.all([processNextJob(makeDeps()), processNextJob(makeDeps())]);
    expect(outcomes.filter((o) => o.status === "completed")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "idle")).toHaveLength(1);
    expect(await db.admin(`SELECT 1 FROM graph_snapshots WHERE repo_id = $1 AND id <> $2`, [s.repoA, s.snapA])).toHaveLength(1);
  });

  it("fails jobs left 'running' by a dead worker", async () => {
    const logId = await queueScan();
    await db.admin(`UPDATE scan_logs SET status = 'running', started_at = now() - interval '2 hours' WHERE id = $1`, [logId]);
    await processNextJob(makeDeps());
    const log = await logRow(logId);
    expect(log.status).toBe("failed");
    expect(String(log.error_message)).toMatch(/stopped/i);
  });
});
