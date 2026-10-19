import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalDb, PgClient, type LocalDb } from "@trailmap/localdb";
import { loadComplianceContext, overrideFromRow, resolvePolicy, scopesFromPolicy } from "./context";

const row = (kind: string, payload: Record<string, unknown>) => ({ id: "o1", kind: kind as never, payload, reason: "because", actor_id: "u1", created_at: "2026-01-01T00:00:00.000Z" });

describe("overrideFromRow", () => {
  it("reads each kind of decision", () => {
    expect(overrideFromRow(row("confirm_edge", { edgeId: "e1" }), "kay")).toMatchObject({ kind: "confirm_edge", edgeId: "e1", actor: "kay", reason: "because" });
    expect(overrideFromRow(row("hide_edge", { edgeId: "e1" }), "kay")).toMatchObject({ kind: "hide_edge" });
    expect(overrideFromRow(row("hide_node", { nodeId: "n1" }), "kay")).toMatchObject({ kind: "hide_node", nodeId: "n1" });
    expect(overrideFromRow(row("add_edge", { from: "a", to: "b", edgeType: "http" }), "kay")).toMatchObject({ kind: "add_edge", from: "a", to: "b" });
    expect(overrideFromRow(row("set_data_class", { target: { kind: "edge", id: "e" }, class: "PII", present: true }), "kay")).toMatchObject({ kind: "set_data_class", class: "PII", present: true });
  });

  it("returns null for rows it cannot interpret instead of throwing", () => {
    expect(overrideFromRow(row("confirm_edge", {}), "k")).toBeNull();
    expect(overrideFromRow(row("hide_node", { nodeId: 3 }), "k")).toBeNull();
    expect(overrideFromRow(row("add_edge", { from: "a" }), "k")).toBeNull();
    expect(overrideFromRow(row("set_data_class", { target: { kind: "thing", id: "x" }, class: "PII", present: true }), "k")).toBeNull();
    expect(overrideFromRow(row("set_data_class", { class: "PII", present: true }), "k")).toBeNull();
    expect(overrideFromRow(row("unknown_kind", {}), "k")).toBeNull();
  });
});

describe("policy resolution", () => {
  it("merges the repository file with app settings, which win", () => {
    const { policy, errors } = resolvePolicy("version: 1\non_drift: neutral\nframeworks: [soc2]\n", { on_drift: "failure" });
    expect(errors).toEqual([]);
    expect(policy.on_drift).toBe("failure");
    expect(policy.frameworks).toEqual(["soc2"]);
  });

  it("falls back to defaults and reports problems when the file is broken or absent", () => {
    expect(resolvePolicy(null, null).policy.on_drift).toBe("neutral");
    const bad = resolvePolicy("on_drift: explode\n", null);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.policy.on_drift).toBe("neutral");
  });

  it("turns policy scopes into scopes with stable ids", () => {
    const { policy } = resolvePolicy("version: 1\nscopes:\n  - name: CDE\n    nodes: [b, a]\n", null);
    expect(scopesFromPolicy(policy)).toEqual([{ id: "policy:CDE", name: "CDE", nodeIds: ["a", "b"] }]);
  });
});

describe("loadComplianceContext", () => {
  let db: LocalDb;
  let repo: string;
  let user: string;

  beforeAll(async () => {
    db = await createLocalDb();
    user = "00000000-0000-4000-8000-00000000000a";
    const org = "00000000-0000-4000-8000-0000000000a1";
    repo = "00000000-0000-4000-8000-0000000000b1";
    await db.admin(`INSERT INTO auth.users (id, email) VALUES ($1, 'ctx@example.com')`, [user]);
    await db.admin(`INSERT INTO organizations (id, github_org_id, github_org_name, github_installation_id, owner_user_id) VALUES ($1, 1, 'ctx', 1, $2)`, [org, user]);
    await db.admin(`INSERT INTO repos (id, org_id, github_repo_id, name, full_name) VALUES ($1, $2, 1, 'r', 'ctx/r')`, [repo, org]);
  });
  afterAll(async () => {
    await db.pg.close();
  });

  const client = () => new PgClient(db, "service_role", null) as never;

  it("is empty for a repository nobody has configured", async () => {
    expect(await loadComplianceContext(client(), repo)).toEqual({ scopes: [], overrides: [], appPolicy: null });
  });

  it("collects scopes (sorted), active overrides with an actor label, and app policy", async () => {
    const [{ id: s2 }] = await db.admin<{ id: string }>(`INSERT INTO scopes (repo_id, name) VALUES ($1, 'B scope') RETURNING id`, [repo]);
    const [{ id: s1 }] = await db.admin<{ id: string }>(`INSERT INTO scopes (repo_id, name) VALUES ($1, 'A scope') RETURNING id`, [repo]);
    await db.admin(`INSERT INTO scope_members (scope_id, node_id) VALUES ($1, 'z'), ($1, 'y'), ($2, 'x')`, [s1, s2]);
    await db.admin(`INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'hide_node', '{"nodeId":"n"}', 'noise', $2)`, [repo, user]);
    await db.admin(`INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id, revoked_at) VALUES ($1, 'hide_node', '{"nodeId":"gone"}', 'old', $2, now())`, [repo, user]);
    await db.admin(`INSERT INTO repo_policies (repo_id, config) VALUES ($1, '{"on_drift":"failure"}')`, [repo]);

    const ctx = await loadComplianceContext(client(), repo);
    expect(ctx.scopes.map((s) => s.name)).toEqual(["A scope", "B scope"]);
    expect(ctx.scopes[0]!.nodeIds).toEqual(["y", "z"]);
    expect(ctx.overrides).toHaveLength(1);
    expect(ctx.overrides[0]).toMatchObject({ kind: "hide_node", nodeId: "n", actor: "ctx@example.com" });
    expect(ctx.appPolicy).toEqual({ on_drift: "failure" });
  });
});
