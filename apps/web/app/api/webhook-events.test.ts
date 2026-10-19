import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, ids, seedTwoOrgs, type TestDb } from "../../../../supabase/tests/db";
import { adminClient, anonClient, userClient } from "../../../../supabase/tests/pg-client";
import { signGithubPayload } from "@/lib/webhook-signature";

const state = vi.hoisted(() => ({ db: null as unknown, permission: "write" as string }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => anonClient(state.db as TestDb),
  supabaseAdmin: () => adminClient(state.db as TestDb),
}));
vi.mock("@/lib/github-api", () => ({
  githubApi: {
    getDefaultBranch: async (_i: number, fullName: string) => (fullName.endsWith("newrepo") ? "trunk" : "main"),
    getPermission: async () => state.permission,
  },
}));

import { POST as webhook } from "./webhooks/github/route";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => fs.readFileSync(path.join(here, "..", "..", "test-fixtures", "github", name), "utf8");
const SECRET = "fixture-secret";

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;

async function send(event: string, file: string) {
  const body = fixture(file);
  const res = await webhook(
    new Request("http://x", { method: "POST", body, headers: { "x-github-event": event, "x-hub-signature-256": signGithubPayload(SECRET, body) } })
  );
  return { status: res.status, json: (await res.json()) as { detail?: string; handled?: boolean } };
}
const attCount = async () => (await db.admin(`SELECT 1 FROM attestations`)).length;
const jobs = async (kind: string) => db.admin<{ payload: Record<string, unknown>; status: string }>(`SELECT payload, status FROM scan_logs WHERE kind = $1 ORDER BY created_at`, [kind]);

beforeAll(async () => {
  db = await createTestDb();
  state.db = db;
  s = await seedTwoOrgs(db);
  await db.admin(`UPDATE organizations SET github_installation_id = 4242 WHERE id = $1`, [s.orgA]);
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", SECRET);
});
afterAll(async () => {
  await db.pg.close();
});
beforeEach(async () => {
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", SECRET);
  state.permission = "write";
  await db.admin(`DELETE FROM scan_logs`);
  await db.admin(`DELETE FROM drift_events`);
  await db.admin(`UPDATE repos SET is_active = true WHERE id = $1`, [s.repoA]);
  void userClient;
});

describe("push", () => {
  it("queues a scan for the default branch only", async () => {
    expect((await send("push", "push-default-branch.json")).json.detail).toBe("enqueued 1");
    expect(await jobs("scan")).toHaveLength(1);
    await db.admin(`DELETE FROM scan_logs`);
    expect((await send("push", "push-feature-branch.json")).json.detail).toMatch(/not the default branch/);
    expect(await jobs("scan")).toHaveLength(0);
  });
});

describe("pull_request", () => {
  it.each(["pull-request-opened.json", "pull-request-synchronize.json"])("%s queues one PR check, not a scan, and never runs it inline", async (file) => {
    const r = await send("pull_request", file);
    expect(r.status).toBe(200);
    expect(await jobs("pr_check")).toEqual([{ payload: { prNumber: 7 }, status: "pending" }]);
    expect(await jobs("scan")).toHaveLength(0);
  });

  it("coalesces repeated pushes into a single pending check", async () => {
    await send("pull_request", "pull-request-opened.json");
    await send("pull_request", "pull-request-synchronize.json");
    expect(await jobs("pr_check")).toHaveLength(1);
  });

  it("a pending PR check does not block a scan of the same repo", async () => {
    await send("pull_request", "pull-request-opened.json");
    await send("push", "push-default-branch.json");
    expect(await jobs("scan")).toHaveLength(1);
  });

  it("ignores closed PRs and unrelated actions, and inactive repos", async () => {
    await send("pull_request", "pull-request-closed.json");
    await send("pull_request", "pull-request-labeled.json");
    expect(await jobs("pr_check")).toHaveLength(0);
    await db.admin(`UPDATE repos SET is_active = false WHERE id = $1`, [s.repoA]);
    await send("pull_request", "pull-request-opened.json");
    expect(await jobs("pr_check")).toHaveLength(0);
  });
});

describe("check_run re-run", () => {
  it("re-queues the check when someone re-runs Trailmap's check, and ignores other checks", async () => {
    await send("check_run", "check-run-other-app.json");
    expect(await jobs("pr_check")).toHaveLength(0);
    await send("check_run", "check-run-rerequested.json");
    expect(await jobs("pr_check")).toHaveLength(1);
  });
});

describe("/trailmap ack", () => {
  const seedEvent = async () =>
    (await db.admin<{ id: string }>(
      `INSERT INTO drift_events (repo_id, pr_number, head_sha, head_graph_hash, conclusion) VALUES ($1, 7, 'headsha1', $2, 'failure') RETURNING id`,
      [s.repoA, "e".repeat(64)]
    ))[0]!.id;

  it("records an attestation bound to the reported graph and queues a re-check", async () => {
    const eventId = await seedEvent();
    const r = await send("issue_comment", "issue-comment-ack.json");
    expect(r.json.detail).toBe("acknowledged by kay");
    const att = await db.admin<{ kind: string; graph_hash: string; drift_event_id: string; actor_label: string; actor_user_id: string | null }>(`SELECT * FROM attestations`);
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ kind: "drift_ack", graph_hash: "e".repeat(64), drift_event_id: eventId, actor_label: "kay (GitHub)", actor_user_id: null });
    expect(await jobs("pr_recheck")).toEqual([{ payload: { driftEventId: eventId }, status: "pending" }]);
  });

  it("is ignored for people without write access", async () => {
    await seedEvent();
    const before = await attCount();
    state.permission = "read";
    const r = await send("issue_comment", "issue-comment-ack.json");
    expect(r.json.detail).toMatch(/read access/);
    expect(await attCount()).toBe(before);
    expect(await jobs("pr_recheck")).toHaveLength(0);
  });

  it("is ignored for bots, for look-alike commands, and outside pull requests", async () => {
    await seedEvent();
    const before = await attCount();
    await send("issue_comment", "issue-comment-ack-bot.json");
    await send("issue_comment", "issue-comment-other.json");
    await send("issue_comment", "issue-comment-not-a-pr.json");
    expect(await attCount()).toBe(before);
  });

  it("does nothing when there is no drift event, or when it is already acknowledged", async () => {
    const before = await attCount();
    expect((await send("issue_comment", "issue-comment-ack.json")).json.detail).toBe("nothing to acknowledge");
    const id = await seedEvent();
    await db.admin(`UPDATE drift_events SET status = 'acknowledged' WHERE id = $1`, [id]);
    expect((await send("issue_comment", "issue-comment-ack.json")).json.detail).toBe("nothing to acknowledge");
    expect(await attCount()).toBe(before);
  });
});

describe("installation events", () => {
  it("records a new installation on an org we already know", async () => {
    await send("installation", "installation-created.json");
    const row = await db.admin<{ github_installation_id: string }>(`SELECT github_installation_id FROM organizations WHERE github_org_id = 2`);
    expect(Number(row[0]!.github_installation_id)).toBe(5555);
  });

  it("adds new repos with their real default branch, without reactivating or resetting known ones", async () => {
    await send("installation_repositories", "installation-repositories-added.json");
    const repos = await db.admin<{ full_name: string; default_branch: string; is_active: boolean }>(`SELECT full_name, default_branch, is_active FROM repos WHERE org_id = $1 ORDER BY full_name`, [s.orgA]);
    expect(repos).toEqual([
      { full_name: "org-a/a", default_branch: "main", is_active: true },
      { full_name: "org-a/newrepo", default_branch: "trunk", is_active: false },
    ]);
    await send("installation_repositories", "installation-repositories-removed.json");
    expect((await db.admin<{ is_active: boolean }>(`SELECT is_active FROM repos WHERE full_name = 'org-a/newrepo'`))[0]!.is_active).toBe(false);
  });

  it("deactivates repos and clears the installation when the app is uninstalled", async () => {
    await send("installation", "installation-deleted.json");
    const org = await db.admin<{ github_installation_id: string | null }>(`SELECT github_installation_id FROM organizations WHERE id = $1`, [s.orgA]);
    expect(org[0]!.github_installation_id).toBeNull();
    expect((await db.admin<{ is_active: boolean }>(`SELECT is_active FROM repos WHERE id = $1`, [s.repoA]))[0]!.is_active).toBe(false);
    await db.admin(`UPDATE organizations SET github_installation_id = 4242 WHERE id = $1`, [s.orgA]);
  });
});

describe("signature", () => {
  it("rejects an unsigned or wrongly signed delivery before doing anything", async () => {
    const body = fixture("pull-request-opened.json");
    const bad = await webhook(new Request("http://x", { method: "POST", body, headers: { "x-github-event": "pull_request", "x-hub-signature-256": signGithubPayload("nope", body) } }));
    expect(bad.status).toBe(401);
    const none = await webhook(new Request("http://x", { method: "POST", body, headers: { "x-github-event": "pull_request" } }));
    expect(none.status).toBe(401);
    expect(await jobs("pr_check")).toHaveLength(0);
    expect(ids.userA).toBeTruthy();
  });
});
