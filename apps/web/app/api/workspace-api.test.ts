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

import { POST as createScope } from "./repos/[repoId]/scopes/route";
import { PUT as updateScope, DELETE as deleteScope } from "./repos/[repoId]/scopes/[scopeId]/route";
import { POST as createOverride, parseOverride } from "./repos/[repoId]/overrides/route";
import { DELETE as revokeOverride } from "./repos/[repoId]/overrides/[overrideId]/route";
import { PUT as putVendor } from "./repos/[repoId]/vendors/[vendorId]/route";
import { GET as getPolicy, PUT as putPolicy } from "./repos/[repoId]/policy/route";
import { GET as exportGet } from "./repos/[repoId]/export/route";

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;
let graphHash: string;

const asUser = (id: string | null) => { state.userId = id; };
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const send = (method: string, body?: unknown) =>
  new Request("http://x", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
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

beforeAll(async () => {
  db = await createTestDb();
  state.db = db;
  s = await seedTwoOrgs(db);
  await db.admin(`INSERT INTO auth.users (id, email) VALUES ($1, 'c@example.com')`, [userC]);
  await db.admin(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')`, [s.orgA, userC]);
  const g = graph();
  graphHash = g.meta.graphHash as string;
  await db.admin(
    `INSERT INTO graph_snapshots (repo_id, raw_json, node_count, edge_count, commit_sha) VALUES ($1, $2, 3, 2, 'c0ffee')`,
    [s.repoA, JSON.stringify(g)]
  );
});
afterAll(async () => {
  await db.pg.close();
});
beforeEach(() => asUser(null));

describe("scopes", () => {
  let scopeId: string;

  it("an admin creates a scope and edits its members", async () => {
    asUser(ids.userA);
    const res = await createScope(send("POST", { name: "CDE", nodeIds: ["service:api", "db:postgres", "service:api"] }), params({ repoId: s.repoA }));
    expect(res.status).toBe(201);
    scopeId = (await res.json()).id;
    expect((await rows(`SELECT node_id FROM scope_members WHERE scope_id = $1 ORDER BY node_id`, [scopeId])).map((r) => r.node_id)).toEqual(["db:postgres", "service:api"]);

    const upd = await updateScope(send("PUT", { name: "Cardholder data", nodeIds: ["service:api", "service:web"] }), params({ repoId: s.repoA, scopeId }));
    expect(upd.status).toBe(200);
    expect((await rows(`SELECT node_id FROM scope_members WHERE scope_id = $1 ORDER BY node_id`, [scopeId])).map((r) => r.node_id)).toEqual(["service:api", "service:web"]);
    expect((await rows<{ name: string }>(`SELECT name FROM scopes WHERE id = $1`, [scopeId]))[0]!.name).toBe("Cardholder data");
  });

  it("rejects malformed input and duplicate names", async () => {
    asUser(ids.userA);
    expect((await createScope(send("POST", { name: "", nodeIds: [] }), params({ repoId: s.repoA }))).status).toBe(400);
    expect((await createScope(send("POST", { name: "x", nodeIds: [1] }), params({ repoId: s.repoA }))).status).toBe(400);
    expect((await createScope(send("POST", { name: "Cardholder data", nodeIds: [] }), params({ repoId: s.repoA }))).status).toBe(409);
  });

  it("is refused for members, other orgs and anonymous callers", async () => {
    asUser(userC);
    expect((await createScope(send("POST", { name: "m", nodeIds: [] }), params({ repoId: s.repoA }))).status).toBe(403);
    expect((await updateScope(send("PUT", { nodeIds: [] }), params({ repoId: s.repoA, scopeId }))).status).toBe(403);
    asUser(ids.userB);
    expect((await createScope(send("POST", { name: "b", nodeIds: [] }), params({ repoId: s.repoA }))).status).toBe(404);
    expect((await updateScope(send("PUT", { name: "hijack" }), params({ repoId: s.repoA, scopeId }))).status).toBe(404);
    expect((await deleteScope(send("DELETE"), params({ repoId: s.repoA, scopeId }))).status).toBe(404);
    asUser(null);
    expect((await createScope(send("POST", { name: "a", nodeIds: [] }), params({ repoId: s.repoA }))).status).toBe(401);
    expect((await rows<{ name: string }>(`SELECT name FROM scopes WHERE id = $1`, [scopeId]))[0]!.name).toBe("Cardholder data");
  });

  it("an admin can delete it", async () => {
    asUser(ids.userA);
    expect((await deleteScope(send("DELETE"), params({ repoId: s.repoA, scopeId }))).status).toBe(200);
    expect(await rows(`SELECT 1 FROM scopes WHERE id = $1`, [scopeId])).toHaveLength(0);
    expect((await deleteScope(send("DELETE"), params({ repoId: s.repoA, scopeId: "nope" }))).status).toBe(404);
  });
});

describe("overrides", () => {
  it("validates decisions", () => {
    expect(parseOverride({ kind: "confirm_edge", edgeId: "e_1" })).toEqual({ kind: "confirm_edge", payload: { edgeId: "e_1" } });
    expect(parseOverride({ kind: "add_edge", from: "a", to: "b", edgeType: "http" })).not.toBeNull();
    expect(parseOverride({ kind: "add_edge", from: "a", to: "b", edgeType: "teleport" })).toBeNull();
    expect(parseOverride({ kind: "set_data_class", target: { kind: "edge", id: "e" }, class: "PII", present: true })).not.toBeNull();
    expect(parseOverride({ kind: "set_data_class", target: { kind: "edge", id: "e" }, class: "NOPE", present: true })).toBeNull();
    expect(parseOverride({ kind: "drop_database" })).toBeNull();
  });

  it("are recorded with a reason and can be revoked, leaving history", async () => {
    asUser(ids.userA);
    expect((await createOverride(send("POST", { kind: "hide_edge", edgeId: "e_1" }), params({ repoId: s.repoA }))).status).toBe(400); // no reason
    const res = await createOverride(send("POST", { kind: "hide_edge", edgeId: "e_1", reason: "test fixture traffic" }), params({ repoId: s.repoA }));
    expect(res.status).toBe(201);
    const overrideId = (await res.json()).id;
    asUser(userC);
    expect((await revokeOverride(send("DELETE"), params({ repoId: s.repoA, overrideId }))).status).toBe(404);
    expect((await createOverride(send("POST", { kind: "hide_edge", edgeId: "e_2", reason: "x" }), params({ repoId: s.repoA }))).status).toBe(403);
    asUser(ids.userB);
    expect((await createOverride(send("POST", { kind: "hide_edge", edgeId: "e_2", reason: "x" }), params({ repoId: s.repoA }))).status).toBe(404);
    asUser(ids.userA);
    expect((await revokeOverride(send("DELETE"), params({ repoId: s.repoA, overrideId }))).status).toBe(200);
    const row = (await rows<{ revoked_at: string | null; revoked_by: string | null }>(`SELECT revoked_at, revoked_by FROM graph_overrides WHERE id = $1`, [overrideId]))[0]!;
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoked_by).toBe(ids.userA);
    expect((await revokeOverride(send("DELETE"), params({ repoId: s.repoA, overrideId }))).status).toBe(404);
  });
});

describe("vendor records and policy", () => {
  it("an admin records vendor details; members cannot", async () => {
    asUser(ids.userA);
    expect((await putVendor(send("PUT", { purpose: "Payments", region: "US", dpaOnFile: true }), params({ repoId: s.repoA, vendorId: "vendor:stripe" }))).status).toBe(200);
    expect((await putVendor(send("PUT", { purpose: "Payments v2", dpaOnFile: false }), params({ repoId: s.repoA, vendorId: "vendor:stripe" }))).status).toBe(200);
    const v = await rows<{ purpose: string; dpa_on_file: boolean; source: string }>(`SELECT purpose, dpa_on_file, source FROM vendors WHERE org_id = $1`, [s.orgA]);
    expect(v).toEqual([{ purpose: "Payments v2", dpa_on_file: false, source: "manual" }]);
    expect((await putVendor(send("PUT", {}), params({ repoId: s.repoA, vendorId: "bad id!" }))).status).toBe(400);
    asUser(userC);
    expect((await putVendor(send("PUT", { purpose: "x" }), params({ repoId: s.repoA, vendorId: "vendor:x" }))).status).toBe(403);
  });

  it("policy validates frameworks and merges field by field", async () => {
    asUser(ids.userA);
    expect((await putPolicy(send("PUT", { frameworks: ["made-up"] }), params({ repoId: s.repoA }))).status).toBe(400);
    expect((await putPolicy(send("PUT", { on_drift: "explode" }), params({ repoId: s.repoA }))).status).toBe(400);
    expect((await putPolicy(send("PUT", { frameworks: ["pci-dss"] }), params({ repoId: s.repoA }))).status).toBe(200);
    const res = await putPolicy(send("PUT", { on_drift: "failure" }), params({ repoId: s.repoA }));
    expect((await res.json()).config).toEqual({ frameworks: ["pci-dss"], on_drift: "failure" });
    asUser(userC);
    expect((await (await getPolicy(send("GET"), params({ repoId: s.repoA }))).json()).config.on_drift).toBe("failure");
    expect((await putPolicy(send("PUT", { on_drift: "neutral" }), params({ repoId: s.repoA }))).status).toBe(403);
    asUser(ids.userB);
    expect((await getPolicy(send("GET"), params({ repoId: s.repoA }))).status).toBe(404);
  });
});

describe("export", () => {
  const get = (q: string, repoId = s.repoA) => exportGet(new Request(`http://x/?${q}`), params({ repoId }));

  it("returns an SVG whose title block carries the graph hash, and records the export", async () => {
    asUser(ids.userA);
    const res = await get("format=svg&sheet=system");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-trailmap-graph-hash")).toBe(graphHash);
    const text = await res.text();
    expect(text.startsWith("<svg")).toBe(true);
    expect(text).toContain(graphHash.slice(0, 12));
    const rec = await rows<{ format: string; graph_hash: string; file_hash: string }>(`SELECT format, graph_hash, file_hash FROM exports WHERE repo_id = $1`, [s.repoA]);
    expect(rec).toHaveLength(1);
    expect(rec[0]!.graph_hash).toBe(graphHash);
    expect(res.headers.get("x-trailmap-file-hash")).toBe(rec[0]!.file_hash);
  });

  it("returns a PDF, JSON, CSV and a zip pack", async () => {
    asUser(userC); // plain members may export
    const pdf = new Uint8Array(await (await get("format=pdf")).arrayBuffer());
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const json = await (await get("format=json")).json();
    expect(JSON.stringify(json)).toContain(graphHash);
    expect((await get("format=csv")).headers.get("content-type")).toContain("text/csv");
    const zip = new Uint8Array(await (await get("format=pack")).arrayBuffer());
    expect(zip[0]).toBe(0x50); // "PK"
    expect(zip[1]).toBe(0x4b);
  });

  it("rejects bad parameters and is closed to outsiders", async () => {
    asUser(ids.userA);
    expect((await get("format=docx")).status).toBe(400);
    expect((await get("format=pdf&sheet=nope")).status).toBe(400);
    asUser(ids.userB);
    expect((await get("format=pdf")).status).toBe(404);
    asUser(null);
    expect((await get("format=pdf")).status).toBe(401);
  });
});
