import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareGraphForWrite, type DependencyGraph } from "@trailmap/graph";
import { createTestDb, ids, seedTwoOrgs, type TestDb } from "../../../../supabase/tests/db";
import { adminClient, anonClient, userClient } from "../../../../supabase/tests/pg-client";

const userC = "00000000-0000-0000-0000-00000000000c"; // plain member of org A
const state = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => {
    const db = state.db as TestDb;
    return state.userId ? userClient(db, state.userId) : anonClient(db);
  },
  supabaseAdmin: () => adminClient(state.db as TestDb),
}));

import { GET as listKeys, POST as createKey } from "./settings/api-keys/route";
import { DELETE as revokeKey } from "./settings/api-keys/[keyId]/route";
import { GET as mcpGraph } from "./mcp/graph/[repoId]/route";
import { GET as mcpScope } from "./mcp/scope/[repoId]/route";
import { POST as mcpCheck } from "./mcp/check/[repoId]/route";
import { POST as ingest } from "./ingest/[repoId]/route";
import { POST as ack } from "./repos/[repoId]/drift/[eventId]/ack/route";
import { POST as attest } from "./repos/[repoId]/attestations/route";

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;
let eventA: string;
let snapshotA: string;

const asUser = (id: string | null) => { state.userId = id; };
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const rows = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => db.admin<T>(sql, args);

const graph = (): DependencyGraph => prepareGraphForWrite({
  meta: { repo: "org-a/a", scanned_at: "2026-01-01T00:00:00.000Z", language_breakdown: {}, total_files: 3 },
  nodes: [
    { id: "service:api", name: "api", type: "service", language: "typescript", port: null, endpoints: [], path: "services/api" },
    { id: "service:web", name: "web", type: "service", language: "typescript", port: null, endpoints: [], path: "services/web" },
    { id: "db:postgres", name: "PostgreSQL", type: "database", language: "unknown", port: null, endpoints: [], path: "", engine: "postgres" },
  ],
  edges: [
    { id: "e_1", from: "service:web", to: "service:api", type: "http", confidence: "high" },
    { id: "e_2", from: "service:api", to: "db:postgres", type: "database", confidence: "medium" },
  ],
});

async function newKey(): Promise<string> {
  asUser(ids.userA);
  const res = await createKey(json({ orgId: s.orgA, name: "ci" }));
  expect(res.status).toBe(201);
  return (await res.json()).key as string;
}

beforeAll(async () => {
  db = await createTestDb();
  state.db = db;
  s = await seedTwoOrgs(db);
  await db.admin(`INSERT INTO auth.users (id, email) VALUES ($1, 'c@example.com')`, [userC]);
  await db.admin(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')`, [s.orgA, userC]);
  const g = graph();
  for (const [repo, snapVar] of [[s.repoA, "A"], [s.repoB, "B"]] as const) {
    const id = (await db.admin<{ id: string }>(
      `INSERT INTO graph_snapshots (repo_id, raw_json, node_count, edge_count, commit_sha) VALUES ($1, $2, 3, 2, 'c0ffee') RETURNING id`,
      [repo, JSON.stringify(g)]
    ))[0]!.id;
    if (snapVar === "A") snapshotA = id;
  }
  eventA = (await db.admin<{ id: string }>(
    `INSERT INTO drift_events (repo_id, pr_number, head_sha, head_graph_hash, conclusion, status) VALUES ($1, 3, 'sha', $2, 'failure', 'open') RETURNING id`,
    [s.repoA, "d".repeat(64)]
  ))[0]!.id;
});
afterAll(async () => {
  await db.pg.close();
});
beforeEach(() => asUser(null));

describe("API keys", () => {
  it("are created by org admins, returned once, and stored only as a hash", async () => {
    const key = await newKey();
    expect(key).toMatch(/^tmk_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const stored = await rows<{ key_hash: string; prefix: string }>(`SELECT key_hash, prefix FROM api_keys WHERE org_id = $1`, [s.orgA]);
    expect(stored.every((r) => r.key_hash !== key && r.key_hash.length === 64)).toBe(true);
    expect(key.startsWith(stored.at(-1)!.prefix)).toBe(true);
    expect(JSON.stringify(await rows(`SELECT * FROM audit_events`))).not.toContain(key);
  });

  it("cannot be created by plain members, other orgs' users, or anonymous callers", async () => {
    asUser(userC);
    expect((await createKey(json({ orgId: s.orgA, name: "x" }))).status).toBe(403);
    asUser(ids.userB);
    expect((await createKey(json({ orgId: s.orgA, name: "x" }))).status).toBe(403);
    asUser(null);
    expect((await createKey(json({ orgId: s.orgA, name: "x" }))).status).toBe(401);
    asUser(ids.userA);
    expect((await createKey(json({ orgId: s.orgA, name: "" }))).status).toBe(400);
    expect((await createKey(json({ orgId: "nope", name: "x" }))).status).toBe(400);
  });

  it("list shows prefixes to admins and nothing to everyone else", async () => {
    asUser(ids.userA);
    const mine = await (await listKeys(new Request(`http://x/?orgId=${s.orgA}`))).json();
    expect(mine.keys.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine)).not.toContain("key_hash");
    asUser(ids.userB);
    expect((await (await listKeys(new Request(`http://x/?orgId=${s.orgA}`))).json()).keys).toEqual([]);
    asUser(userC);
    expect((await (await listKeys(new Request(`http://x/?orgId=${s.orgA}`))).json()).keys).toEqual([]);
  });

  it("stop working once revoked, and only admins of the org can revoke", async () => {
    const key = await newKey();
    expect((await mcpGraph(new Request("http://x", { headers: bearer(key) }), params({ repoId: s.repoA }))).status).toBe(200);
    const keyId = (await rows<{ id: string }>(`SELECT id FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`, [s.orgA]))[0]!.id;

    asUser(ids.userB);
    expect((await revokeKey(new Request("http://x"), params({ keyId }))).status).toBe(404);
    asUser(userC);
    expect((await revokeKey(new Request("http://x"), params({ keyId }))).status).toBe(404);
    asUser(ids.userA);
    expect((await revokeKey(new Request("http://x"), params({ keyId }))).status).toBe(200);
    expect((await mcpGraph(new Request("http://x", { headers: bearer(key) }), params({ repoId: s.repoA }))).status).toBe(401);
    expect((await rows(`SELECT 1 FROM audit_events WHERE action = 'api_key.revoked'`)).length).toBeGreaterThan(0);
  });
});

describe("key-authenticated endpoints", () => {
  let key: string;
  beforeAll(async () => { key = await newKey(); });

  it("reject missing, malformed and unknown keys", async () => {
    for (const headers of [{}, { authorization: "Bearer nope" }, bearer("tmk_00000000_" + "A".repeat(43)), { authorization: "Basic abc" }]) {
      const res = await mcpGraph(new Request("http://x", { headers }), params({ repoId: s.repoA }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
    }
  });

  it("serve the org's own repo and treat another org's repo as missing", async () => {
    const own = await mcpGraph(new Request("http://x", { headers: bearer(key) }), params({ repoId: s.repoA }));
    expect(own.status).toBe(200);
    const body = await own.json();
    expect(body.repo.fullName).toBe("org-a/a");
    expect(body.graph.nodes).toHaveLength(3);
    expect(body.snapshot.commitSha).toBe("c0ffee");

    expect((await mcpGraph(new Request("http://x", { headers: bearer(key) }), params({ repoId: s.repoB }))).status).toBe(404);
    expect((await mcpScope(new Request("http://x", { headers: bearer(key) }), params({ repoId: s.repoB }))).status).toBe(404);
    expect((await mcpCheck(json({ files: ["a.ts"] }, bearer(key)), params({ repoId: s.repoB }))).status).toBe(404);
    expect((await mcpGraph(new Request("http://x", { headers: bearer(key) }), params({ repoId: "not-a-uuid" }))).status).toBe(404);
  });

  it("apply human decisions: a hidden edge is gone, a scope shows its boundary", async () => {
    await db.admin(`INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'hide_edge', '{"edgeId":"e_1"}', 'not real', $2)`, [s.repoA, ids.userA]);
    const scope = (await db.admin<{ id: string }>(`INSERT INTO scopes (repo_id, name, created_by) VALUES ($1, 'CDE', $2) RETURNING id`, [s.repoA, ids.userA]))[0]!.id;
    await db.admin(`INSERT INTO scope_members (scope_id, node_id) VALUES ($1, 'service:api')`, [scope]);

    const g = await (await mcpGraph(new Request("http://x", { headers: bearer(key) }), params({ repoId: s.repoA }))).json();
    expect(g.graph.edges.map((e: { id: string }) => e.id)).toEqual(["e_2"]);

    const sc = await (await mcpScope(new Request("http://x", { headers: bearer(key) }), params({ repoId: s.repoA }))).json();
    expect(sc.scopes[0]).toMatchObject({ name: "CDE" });
    expect(sc.scopes[0].crossings.map((c: { outside: string }) => c.outside)).toEqual(["db:postgres"]);
  });

  it("check_change validates input and reports touched services and the scopes they belong to", async () => {
    const bad = await mcpCheck(json({ files: [] }, bearer(key)), params({ repoId: s.repoA }));
    expect(bad.status).toBe(400);
    expect((await mcpCheck(json({ files: "a" }, bearer(key)), params({ repoId: s.repoA }))).status).toBe(400);
    const ok = await (await mcpCheck(json({ files: ["services/api/src/a.ts"] }, bearer(key)), params({ repoId: s.repoA }))).json();
    expect(ok.impact.touched.map((t: { id: string }) => t.id)).toEqual(["service:api"]);
    expect(ok.impact.affectedDataStores).toEqual(["PostgreSQL"]);
    expect(ok.scopesTouched.map((x: { name: string }) => x.name)).toEqual(["CDE"]);
  });
});

describe("ingest (CI-only mode)", () => {
  let key: string;
  beforeAll(async () => { key = await newKey(); });

  it("stores an uploaded graph as a snapshot", async () => {
    const res = await ingest(json({ graph: graph(), commitSha: "abc", branch: "main" }, bearer(key)), params({ repoId: s.repoA }));
    expect(res.status).toBe(201);
    const { snapshotId, graphHash } = await res.json();
    expect(graphHash).toMatch(/^[0-9a-f]{64}$/);
    const row = (await rows<{ commit_sha: string; branch: string }>(`SELECT commit_sha, branch FROM graph_snapshots WHERE id = $1`, [snapshotId]))[0]!;
    expect(row).toEqual({ commit_sha: "abc", branch: "main" });
    expect((await rows(`SELECT 1 FROM audit_events WHERE action = 'snapshot.uploaded'`)).length).toBeGreaterThan(0);
  });

  it("rejects invalid graphs, bad JSON, wrong org and oversized bodies", async () => {
    expect((await ingest(json({ graph: { nodes: "x" } }, bearer(key)), params({ repoId: s.repoA }))).status).toBe(422);
    expect((await ingest(new Request("http://x", { method: "POST", body: "{nope", headers: bearer(key) }), params({ repoId: s.repoA }))).status).toBe(400);
    expect((await ingest(json({ graph: graph() }, bearer(key)), params({ repoId: s.repoB }))).status).toBe(404);
    expect((await ingest(json({ graph: graph() }), params({ repoId: s.repoA }))).status).toBe(401);
    const big = await ingest(new Request("http://x", { method: "POST", body: "{}", headers: { ...bearer(key), "content-length": String(11 * 1024 * 1024) } }), params({ repoId: s.repoA }));
    expect(big.status).toBe(413);
  });

  it("returns the drift verdict for a pull request graph without storing a snapshot", async () => {
    const before = (await rows(`SELECT 1 FROM graph_snapshots WHERE repo_id = $1`, [s.repoA])).length;
    const head = graph();
    head.nodes.push({ id: "vendor:stripe", name: "Stripe", type: "saas", language: "unknown", port: null, endpoints: [], path: "", vendor: "stripe" });
    head.edges.push({ id: "e_3", from: "service:api", to: "vendor:stripe", type: "http", confidence: "high" });
    const res = await ingest(json({ graph: head, pr: { number: 9, headSha: "sha9" }, policy: "on_drift: failure\n" }, bearer(key)), params({ repoId: s.repoA }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conclusion).toBe("failure");
    expect(body.findings.map((f: { rule: string }) => f.rule)).toContain("new_vendor");
    expect((await rows(`SELECT 1 FROM graph_snapshots WHERE repo_id = $1`, [s.repoA])).length).toBe(before);
    expect((await rows(`SELECT 1 FROM drift_events WHERE pr_number = 9`)).length).toBe(1);

    expect((await ingest(json({ graph: head, pr: { number: 0, headSha: "" } }, bearer(key)), params({ repoId: s.repoA }))).status).toBe(400);
  });
});

describe("acknowledging drift in the app", () => {
  it("records an attestation by the signed-in member, bound to the reported graph, and queues a re-check", async () => {
    asUser(userC);
    const res = await ack(json({ note: "accepted: handled in ticket 42" }), params({ repoId: s.repoA, eventId: eventA }));
    expect(res.status).toBe(202);
    const att = (await rows<{ kind: string; graph_hash: string; actor_label: string; actor_user_id: string; note: string }>(`SELECT * FROM attestations WHERE drift_event_id = $1`, [eventA]))[0]!;
    expect(att).toMatchObject({ kind: "drift_ack", graph_hash: "d".repeat(64), actor_label: "c@example.com", actor_user_id: userC, note: "accepted: handled in ticket 42" });
    const job = (await rows<{ kind: string; payload: { driftEventId: string } }>(`SELECT kind, payload FROM scan_logs WHERE kind = 'pr_recheck'`))[0]!;
    expect(job.payload.driftEventId).toBe(eventA);
  });

  it("is refused for other orgs' users, anonymous callers and unknown events", async () => {
    const open = (await db.admin<{ id: string }>(`INSERT INTO drift_events (repo_id, pr_number, head_sha, head_graph_hash, conclusion) VALUES ($1, 4, 'sha4', $2, 'failure') RETURNING id`, [s.repoA, "9".repeat(64)]))[0]!.id;
    asUser(ids.userB);
    expect((await ack(json({}), params({ repoId: s.repoA, eventId: open }))).status).toBe(404);
    asUser(null);
    expect((await ack(json({}), params({ repoId: s.repoA, eventId: open }))).status).toBe(401);
    asUser(ids.userA);
    expect((await ack(json({}), params({ repoId: s.repoA, eventId: "00000000-0000-0000-0000-000000000000" }))).status).toBe(404);
    expect((await ack(json({}), params({ repoId: s.repoA, eventId: "bad" }))).status).toBe(404);
    expect((await rows(`SELECT 1 FROM attestations WHERE drift_event_id = $1`, [open])).length).toBe(0);
  });

  it("attests a snapshot review bound to that snapshot's hash", async () => {
    asUser(ids.userA);
    const res = await attest(json({ snapshotId: snapshotA, note: "Q3 review" }), params({ repoId: s.repoA }));
    expect(res.status).toBe(201);
    expect((await res.json()).graphHash).toHaveLength(64);
    asUser(ids.userB);
    expect((await attest(json({ snapshotId: snapshotA }), params({ repoId: s.repoA }))).status).toBe(404);
    asUser(ids.userA);
    expect((await attest(json({}), params({ repoId: s.repoA }))).status).toBe(400);
  });
});
