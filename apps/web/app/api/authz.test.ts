import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, ids, seedTwoOrgs, type TestDb } from "../../../../supabase/tests/db";
import { adminClient, anonClient, userClient, PgClient } from "../../../../supabase/tests/pg-client";
import { signGithubPayload } from "@/lib/webhook-signature";

// The routes import these; swap in clients backed by the real schema and RLS policies.
const state = vi.hoisted(() => ({
  db: null as unknown,
  userId: null as string | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => {
    const db = state.db as TestDb;
    return state.userId ? userClient(db, state.userId) : anonClient(db);
  },
  supabaseAdmin: () => adminClient(state.db as TestDb),
}));

const prImpact = vi.hoisted(() => ({
  computePrImpactForRepo: vi.fn(),
  buildPrImpactComment: vi.fn(),
  upsertPrImpactComment: vi.fn(),
}));
vi.mock("@/lib/github-pr-impact", () => prImpact);
vi.mock("@/lib/github-api", () => ({ githubApi: { getDefaultBranch: async () => "main", getPermission: async () => "write" } }));

import { POST as scanPost } from "./repos/[repoId]/scan/route";
import { GET as impactGet } from "./repos/[repoId]/impact/route";
import { POST as commentPost } from "./repos/[repoId]/impact/comment/route";
import { POST as sharePost } from "./maps/share/route";
import { GET as scanLogGet } from "./scan-logs/[scanLogId]/route";
import { POST as webhookPost } from "./webhooks/github/route";

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;
let logB: string;

const asUser = (id: string | null) => {
  state.userId = id;
};
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const count = async (sql: string, args: unknown[] = []) =>
  Number((await db.admin<{ n: string }>(sql, args))[0]!.n);

beforeAll(async () => {
  db = await createTestDb();
  state.db = db;
  s = await seedTwoOrgs(db);
  logB = (
    await db.admin<{ id: string }>(
      `INSERT INTO scan_logs (repo_id, triggered_by, status) VALUES ($1, 'manual', 'completed') RETURNING id`,
      [s.repoB]
    )
  )[0]!.id;
});
afterAll(async () => {
  await db.pg.close();
});
beforeEach(async () => {
  asUser(null);
  prImpact.computePrImpactForRepo.mockReset();
  await db.admin(`DELETE FROM scan_logs WHERE status IN ('pending', 'running')`);
  await db.admin(`DELETE FROM shared_maps`);
});

describe("POST /api/repos/[repoId]/scan", () => {
  it("returns 401 when signed out and queues nothing", async () => {
    const res = await scanPost(new Request("http://x"), params({ repoId: s.repoA }));
    expect(res.status).toBe(401);
    expect(await count(`SELECT count(*) n FROM scan_logs WHERE status = 'pending'`)).toBe(0);
  });

  it("returns 404 for another org's repo and queues nothing", async () => {
    asUser(ids.userA);
    const res = await scanPost(new Request("http://x"), params({ repoId: s.repoB }));
    expect(res.status).toBe(404);
    expect(await count(`SELECT count(*) n FROM scan_logs WHERE repo_id = $1 AND status = 'pending'`, [s.repoB])).toBe(0);
  });

  it("returns 404 for a malformed id", async () => {
    asUser(ids.userA);
    const res = await scanPost(new Request("http://x"), params({ repoId: "not-a-uuid" }));
    expect(res.status).toBe(404);
  });

  it("queues exactly one pending scan for the user's own repo, and reuses it on repeat", async () => {
    asUser(ids.userA);
    const first = await (await scanPost(new Request("http://x"), params({ repoId: s.repoA }))).json();
    const second = await (await scanPost(new Request("http://x"), params({ repoId: s.repoA }))).json();
    expect(first.alreadyQueued).toBe(false);
    expect(second.alreadyQueued).toBe(true);
    expect(second.scanLogId).toBe(first.scanLogId);
    expect(await count(`SELECT count(*) n FROM scan_logs WHERE repo_id = $1 AND status = 'pending'`, [s.repoA])).toBe(1);
  });
});

describe("GET /api/repos/[repoId]/impact and POST .../impact/comment", () => {
  it("refuses signed-out callers", async () => {
    const req = new Request("http://x");
    expect((await impactGet(req as never, params({ repoId: s.repoA }))).status).toBe(401);
  });

  it("returns 404 for another org's repo without computing anything", async () => {
    asUser(ids.userA);
    const get = await impactGet(new Request("http://x/?pr=1") as never, params({ repoId: s.repoB }));
    expect(get.status).toBe(404);
    const post = await commentPost(
      new Request("http://x", { method: "POST", body: JSON.stringify({ prNumber: 1 }) }) as never,
      params({ repoId: s.repoB })
    );
    expect(post.status).toBe(404);
    expect(prImpact.computePrImpactForRepo).not.toHaveBeenCalled();
  });
});

describe("POST /api/maps/share", () => {
  const post = (snapshotId: unknown) =>
    sharePost(new Request("http://x", { method: "POST", body: JSON.stringify({ snapshotId }) }));

  it("returns 401 when signed out", async () => {
    expect((await post(s.snapA)).status).toBe(401);
  });

  it("rejects a missing or malformed snapshotId", async () => {
    asUser(ids.userA);
    expect((await post(undefined)).status).toBe(400);
    expect((await post("nope")).status).toBe(400);
  });

  it("returns 404 for another org's snapshot and creates no link", async () => {
    asUser(ids.userA);
    expect((await post(s.snapB)).status).toBe(404);
    expect(await count(`SELECT count(*) n FROM shared_maps`)).toBe(0);
  });

  it("creates a link for the user's own snapshot and returns the same slug on repeat", async () => {
    asUser(ids.userA);
    const first = await (await post(s.snapA)).json();
    const second = await (await post(s.snapA)).json();
    expect(first.slug).toMatch(/^[\w-]{16}$/);
    expect(second.slug).toBe(first.slug);
    expect(await count(`SELECT count(*) n FROM shared_maps`)).toBe(1);
  });
});

describe("GET /api/scan-logs/[scanLogId]", () => {
  it("returns 401 when signed out", async () => {
    expect((await scanLogGet(new Request("http://x"), params({ scanLogId: logB }))).status).toBe(401);
  });

  it("returns 404 for a log that belongs to another org", async () => {
    asUser(ids.userA);
    expect((await scanLogGet(new Request("http://x"), params({ scanLogId: logB }))).status).toBe(404);
  });

  it("returns the log to a member of the owning org", async () => {
    asUser(ids.userB);
    const res = await scanLogGet(new Request("http://x"), params({ scanLogId: logB }));
    expect(res.status).toBe(200);
    expect((await res.json()).log.id).toBe(logB);
  });
});

describe("POST /api/webhooks/github", () => {
  const SECRET = "test-webhook-secret";
  const push = JSON.stringify({
    ref: "refs/heads/main",
    repository: { id: 10, default_branch: "main" },
  });
  const send = (body: string, headers: Record<string, string>) =>
    webhookPost(new Request("http://x", { method: "POST", body, headers }));

  beforeEach(async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", SECRET);
    await db.admin(`UPDATE repos SET is_active = true`);
  });

  it("fails closed with 500 when the secret is not configured, even for a 'valid' empty-key signature", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const res = await send(push, {
      "x-github-event": "push",
      "x-hub-signature-256": signGithubPayload("", push),
    });
    expect(res.status).toBe(500);
    expect(await count(`SELECT count(*) n FROM scan_logs WHERE status = 'pending'`)).toBe(0);
  });

  it("returns 401 for a bad signature and for a missing one", async () => {
    const bad = await send(push, {
      "x-github-event": "push",
      "x-hub-signature-256": signGithubPayload("wrong", push),
    });
    expect(bad.status).toBe(401);
    expect((await send(push, { "x-github-event": "push" })).status).toBe(401);
    expect(await count(`SELECT count(*) n FROM scan_logs WHERE status = 'pending'`)).toBe(0);
  });

  it("enqueues a scan (does not run one) for a signed push to the default branch", async () => {
    const res = await send(push, {
      "x-github-event": "push",
      "x-hub-signature-256": signGithubPayload(SECRET, push),
    });
    expect(res.status).toBe(200);
    expect(
      await count(`SELECT count(*) n FROM scan_logs WHERE repo_id = $1 AND status = 'pending' AND triggered_by = 'webhook'`, [s.repoA])
    ).toBe(1);
  });

  it("ignores pushes to other branches", async () => {
    const other = JSON.stringify({ ref: "refs/heads/feature", repository: { id: 10, default_branch: "main" } });
    await send(other, { "x-github-event": "push", "x-hub-signature-256": signGithubPayload(SECRET, other) });
    expect(await count(`SELECT count(*) n FROM scan_logs WHERE status = 'pending'`)).toBe(0);
  });

  it("does not enqueue for inactive repos", async () => {
    await db.admin(`UPDATE repos SET is_active = false`);
    await send(push, { "x-github-event": "push", "x-hub-signature-256": signGithubPayload(SECRET, push) });
    expect(await count(`SELECT count(*) n FROM scan_logs WHERE status = 'pending'`)).toBe(0);
  });
});

// Keep the type import used so the adapter stays referenced in this file's graph.
void (null as unknown as PgClient);
