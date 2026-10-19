import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, ids, seedTwoOrgs, type TestDb } from "./db";

const userC = "00000000-0000-0000-0000-00000000000c"; // a plain member of org A
const HASH = "a".repeat(64);

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;
let scopeA: string;
let driftA: string;

const count = async (sql: string, args: unknown[] = []) => Number((await db.admin<{ n: string }>(sql, args))[0]!.n);

beforeAll(async () => {
  db = await createTestDb();
  s = await seedTwoOrgs(db);
  await db.admin(`INSERT INTO auth.users (id, email) VALUES ($1, 'c@example.com')`, [userC]);
  await db.admin(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')`, [s.orgA, userC]);

  scopeA = (await db.admin<{ id: string }>(`INSERT INTO scopes (repo_id, name, created_by) VALUES ($1, 'PCI CDE', $2) RETURNING id`, [s.repoA, ids.userA]))[0]!.id;
  await db.admin(`INSERT INTO scope_members (scope_id, node_id, added_by) VALUES ($1, 'service:api', $2)`, [scopeA, ids.userA]);
  await db.admin(
    `INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'hide_edge', '{"edgeId":"e1"}', 'false positive', $2)`,
    [s.repoA, ids.userA]
  );
  driftA = (await db.admin<{ id: string }>(
    `INSERT INTO drift_events (repo_id, pr_number, head_sha, head_graph_hash, conclusion) VALUES ($1, 7, 'abc', $2, 'failure') RETURNING id`,
    [s.repoA, HASH]
  ))[0]!.id;
  await db.admin(`INSERT INTO attestations (repo_id, kind, graph_hash, actor_user_id, actor_label) VALUES ($1, 'snapshot_review', $2, $3, 'a@example.com')`, [s.repoA, HASH, ids.userA]);
  await db.admin(`INSERT INTO vendors (org_id, vendor_id, purpose, updated_by) VALUES ($1, 'stripe', 'payments', $2)`, [s.orgA, ids.userA]);
  await db.admin(`INSERT INTO api_keys (org_id, name, prefix, key_hash, created_by) VALUES ($1, 'ci', 'tmk_ab12', $2, $3)`, [s.orgA, HASH, ids.userA]);
  await db.admin(`INSERT INTO exports (repo_id, graph_hash, framework, format, file_hash, prepared_by) VALUES ($1, $2, 'pci-dss', 'pdf', $2, $3)`, [s.repoA, HASH, ids.userA]);
  await db.admin(`INSERT INTO repo_policies (repo_id, config, updated_by) VALUES ($1, '{"on_drift":"failure"}', $2)`, [s.repoA, ids.userA]);
});
afterAll(async () => {
  await db.pg.close();
});

describe("tenant isolation on every compliance table", () => {
  const tables = [
    "scopes", "scope_members", "graph_overrides", "drift_events", "attestations", "vendors",
    "api_keys", "exports", "repo_policies", "audit_events",
  ];

  for (const table of tables) {
    it(`${table}: org A's rows are invisible to org B and to anonymous users`, async () => {
      const own = await db.admin<{ n: string }>(`SELECT count(*) n FROM ${table}`);
      expect(Number(own[0]!.n), `${table} should have seeded rows`).toBeGreaterThan(0);

      const asB = await db.as("authenticated", ids.userB, `SELECT * FROM ${table}`).catch(() => []);
      expect(asB, `${table} leaked to org B`).toHaveLength(0);

      const asAnon = await db.as("anon", null, `SELECT * FROM ${table}`).catch(() => []);
      expect(asAnon, `${table} leaked to anon`).toHaveLength(0);
    });
  }

  it("org A members can read their own scopes, overrides, drift events and attestations", async () => {
    for (const table of ["scopes", "scope_members", "graph_overrides", "drift_events", "attestations", "exports", "repo_policies"]) {
      const rows = await db.as("authenticated", userC, `SELECT * FROM ${table}`);
      expect(rows.length, table).toBeGreaterThan(0);
    }
  });
});

describe("cross-tenant writes are rejected", () => {
  const asB = (sql: string, args: unknown[] = []) => db.as("authenticated", ids.userB, sql, args);

  it("cannot create a scope, override, attestation, export or policy against another org's repo", async () => {
    await expect(asB(`INSERT INTO scopes (repo_id, name, created_by) VALUES ($1, 'x', $2)`, [s.repoA, ids.userB])).rejects.toThrow();
    await expect(asB(`INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'hide_edge', '{}', 'r', $2)`, [s.repoA, ids.userB])).rejects.toThrow();
    await expect(asB(`INSERT INTO attestations (repo_id, kind, graph_hash, actor_user_id, actor_label) VALUES ($1, 'snapshot_review', 'h', $2, 'b')`, [s.repoA, ids.userB])).rejects.toThrow();
    await expect(asB(`INSERT INTO exports (repo_id, graph_hash, framework, format, file_hash, prepared_by) VALUES ($1, 'h', 'pci-dss', 'pdf', $2, $3)`, [s.repoA, HASH, ids.userB])).rejects.toThrow();
    await expect(asB(`INSERT INTO repo_policies (repo_id, config, updated_by) VALUES ($1, '{}', $2)`, [s.repoA, ids.userB])).rejects.toThrow();
  });

  it("cannot add members to another org's scope or edit its vendors", async () => {
    await expect(asB(`INSERT INTO scope_members (scope_id, node_id) VALUES ($1, 'service:x')`, [scopeA])).rejects.toThrow();
    await expect(asB(`INSERT INTO vendors (org_id, vendor_id, updated_by) VALUES ($1, 'twilio', $2)`, [s.orgA, ids.userB])).rejects.toThrow();
    const updated = await asB(`UPDATE vendors SET purpose = 'hacked' WHERE org_id = $1 RETURNING id`, [s.orgA]);
    expect(updated).toHaveLength(0);
  });

  it("cannot forge another user as the actor", async () => {
    await expect(
      db.as("authenticated", userC, `INSERT INTO attestations (repo_id, kind, graph_hash, actor_user_id, actor_label) VALUES ($1, 'snapshot_review', 'h', $2, 'someone else')`, [s.repoA, ids.userA])
    ).rejects.toThrow();
  });
});

describe("roles inside an org", () => {
  it("a plain member can attest but cannot create scopes, overrides, API keys or vendor records", async () => {
    await db.as("authenticated", userC, `INSERT INTO attestations (repo_id, kind, graph_hash, actor_user_id, actor_label) VALUES ($1, 'snapshot_review', $2, $3, 'c@example.com')`, [s.repoA, HASH, userC]);
    await expect(db.as("authenticated", userC, `INSERT INTO scopes (repo_id, name, created_by) VALUES ($1, 'm', $2)`, [s.repoA, userC])).rejects.toThrow();
    await expect(db.as("authenticated", userC, `INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'hide_edge', '{}', 'r', $2)`, [s.repoA, userC])).rejects.toThrow();
    await expect(db.as("authenticated", userC, `INSERT INTO vendors (org_id, vendor_id, updated_by) VALUES ($1, 'x', $2)`, [s.orgA, userC])).rejects.toThrow();
    expect(await db.as("authenticated", userC, `SELECT prefix FROM api_keys`)).toHaveLength(0);
  });

  it("an admin can create scopes, overrides and vendor metadata, and see the org's API keys", async () => {
    await db.as("authenticated", ids.userA, `INSERT INTO scopes (repo_id, name, created_by) VALUES ($1, 'SOC 2 boundary', $2)`, [s.repoA, ids.userA]);
    await db.as("authenticated", ids.userA, `INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'confirm_edge', '{"edgeId":"e2"}', 'verified in code', $2)`, [s.repoA, ids.userA]);
    await db.as("authenticated", ids.userA, `INSERT INTO vendors (org_id, vendor_id, region, updated_by) VALUES ($1, 'twilio', 'US', $2)`, [s.orgA, ids.userA]);
    const keys = await db.as<{ prefix: string }>("authenticated", ids.userA, `SELECT prefix FROM api_keys`);
    expect(keys.map((k) => k.prefix)).toEqual(["tmk_ab12"]);
  });

  it("an override needs a reason", async () => {
    await expect(
      db.as("authenticated", ids.userA, `INSERT INTO graph_overrides (repo_id, kind, payload, reason, actor_id) VALUES ($1, 'hide_edge', '{}', '   ', $2)`, [s.repoA, ids.userA])
    ).rejects.toThrow();
  });
});

describe("immutability", () => {
  it("an override's decision cannot be edited, only revoked", async () => {
    await expect(db.as("authenticated", ids.userA, `UPDATE graph_overrides SET payload = '{}' WHERE repo_id = $1`, [s.repoA])).rejects.toThrow(/permission denied/);
    const revoked = await db.as("authenticated", ids.userA, `UPDATE graph_overrides SET revoked_at = now(), revoked_by = $2 WHERE repo_id = $1 AND reason = 'false positive' RETURNING id`, [s.repoA, ids.userA]);
    expect(revoked).toHaveLength(1);
  });

  it("attestations cannot be updated or deleted, even by the service role", async () => {
    await expect(db.as("service_role", null, `UPDATE attestations SET note = 'edited'`)).rejects.toThrow(/append-only/);
    await expect(db.as("service_role", null, `DELETE FROM attestations`)).rejects.toThrow(/append-only/);
    await expect(db.admin(`DELETE FROM attestations`)).rejects.toThrow(/append-only/);
  });
});

describe("attestations and their parents", () => {
  it("are removed together with their repository (foreign-key actions are allowed)", async () => {
    const repo = (await db.admin<{ id: string }>(`INSERT INTO repos (org_id, github_repo_id, name, full_name) VALUES ($1, 77, 'tmp', 'org-a/tmp') RETURNING id`, [s.orgA]))[0]!.id;
    await db.admin(`INSERT INTO attestations (repo_id, kind, graph_hash, actor_label) VALUES ($1, 'snapshot_review', 'h', 'x')`, [repo]);
    await db.admin(`DELETE FROM repos WHERE id = $1`, [repo]);
    expect(await count(`SELECT count(*) n FROM attestations WHERE repo_id = $1`, [repo])).toBe(0);
  });
});

describe("audit_events is append-only", () => {
  it("rejects UPDATE, DELETE and TRUNCATE for every role, including the superuser", async () => {
    await expect(db.admin(`UPDATE audit_events SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.admin(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
    await expect(db.admin(`TRUNCATE audit_events`)).rejects.toThrow(/append-only/);
    await expect(db.as("service_role", null, `DELETE FROM audit_events`)).rejects.toThrow();
    await expect(db.as("authenticated", ids.userA, `UPDATE audit_events SET action = 'x'`)).rejects.toThrow();
  });

  it("cannot be written by a browser session", async () => {
    await expect(db.as("authenticated", ids.userA, `INSERT INTO audit_events (action, target_type) VALUES ('forged', 't')`)).rejects.toThrow();
  });

  it("records compliance changes automatically with the acting user", async () => {
    const before = await count(`SELECT count(*) n FROM audit_events WHERE action = 'scopes.insert'`);
    await db.as("authenticated", ids.userA, `INSERT INTO scopes (repo_id, name, created_by) VALUES ($1, 'audited', $2)`, [s.repoA, ids.userA]);
    const rows = await db.admin<{ actor_user_id: string; org_id: string; repo_id: string; actor_type: string }>(
      `SELECT actor_user_id, org_id, repo_id, actor_type FROM audit_events WHERE action = 'scopes.insert' ORDER BY created_at DESC LIMIT 1`
    );
    expect(await count(`SELECT count(*) n FROM audit_events WHERE action = 'scopes.insert'`)).toBe(before + 1);
    expect(rows[0]).toEqual({ actor_user_id: ids.userA, org_id: s.orgA, repo_id: s.repoA, actor_type: "user" });
  });

  it("never writes secret columns into the log", async () => {
    const hash = "b".repeat(64);
    await db.admin(`INSERT INTO api_keys (org_id, name, prefix, key_hash) VALUES ($1, 'second', 'tmk_cd34', $2)`, [s.orgA, hash]);
    const blob = JSON.stringify(await db.admin(`SELECT metadata FROM audit_events WHERE action = 'api_keys.insert'`));
    expect(blob).not.toContain(hash);
    expect(blob).toContain("tmk_cd34");
    await db.admin(`INSERT INTO shared_maps (snapshot_id, slug, password_hash, created_by) VALUES ($1, 'audit-slug', 'bcrypt-secret', $2)`, [s.snapA, ids.userA]).catch(() => undefined);
  });

  it("lets org members read their own org's trail only", async () => {
    const asA = await db.as<{ org_id: string }>("authenticated", ids.userA, `SELECT org_id FROM audit_events`);
    expect(asA.length).toBeGreaterThan(0);
    expect(asA.every((r) => r.org_id === s.orgA)).toBe(true);
  });
});

describe("API keys", () => {
  it("never expose the hash to API roles, and cannot be created from a browser session", async () => {
    await expect(db.as("authenticated", ids.userA, `SELECT key_hash FROM api_keys`)).rejects.toThrow(/permission denied/);
    await expect(db.as("authenticated", ids.userA, `SELECT * FROM api_keys`)).rejects.toThrow(/permission denied/);
    await expect(db.as("authenticated", ids.userA, `INSERT INTO api_keys (org_id, name, prefix, key_hash) VALUES ($1, 'x', 'p', $2)`, [s.orgA, "c".repeat(64)])).rejects.toThrow();
    await expect(db.as("anon", null, `SELECT prefix FROM api_keys`)).rejects.toThrow();
  });

  it("must hold a 64-character hash, not a raw key", async () => {
    await expect(db.admin(`INSERT INTO api_keys (org_id, name, prefix, key_hash) VALUES ($1, 'raw', 'p', 'tmk_live_not_a_hash')`, [s.orgA])).rejects.toThrow();
  });

  it("resolves a key hash to its org for the server, and stops once revoked", async () => {
    const found = await db.as<{ org_id: string }>("service_role", null, `SELECT * FROM lookup_api_key($1)`, [HASH]);
    expect(found.map((r) => r.org_id)).toEqual([s.orgA]);
    expect((await db.admin<{ last_used_at: string | null }>(`SELECT last_used_at FROM api_keys WHERE key_hash = $1`, [HASH]))[0]!.last_used_at).not.toBeNull();
    await db.admin(`UPDATE api_keys SET revoked_at = now() WHERE key_hash = $1`, [HASH]);
    expect(await db.as("service_role", null, `SELECT * FROM lookup_api_key($1)`, [HASH])).toHaveLength(0);
    expect(await db.as("service_role", null, `SELECT * FROM lookup_api_key($1)`, ["z".repeat(64)])).toHaveLength(0);
  });

  it("cannot be looked up by browser sessions", async () => {
    await expect(db.as("authenticated", ids.userA, `SELECT * FROM lookup_api_key($1)`, [HASH])).rejects.toThrow(/permission denied/);
    await expect(db.as("anon", null, `SELECT * FROM lookup_api_key($1)`, [HASH])).rejects.toThrow(/permission denied/);
  });
});

describe("share links", () => {
  beforeAll(async () => {
    await db.admin(`INSERT INTO shared_maps (snapshot_id, slug, password_hash, label, created_by) VALUES ($1, 'rev-1', 'bcrypt$hash', 'For Acme auditors', $2)`, [s.snapA, ids.userA]);
  });

  it("returns the watermark label to the public resolver, and the hash only to the server", async () => {
    const pub = await db.as<Record<string, unknown>>("anon", null, `SELECT * FROM get_shared_map('rev-1')`);
    expect(pub[0]).toMatchObject({ label: "For Acme auditors", requires_password: true });
    expect(JSON.stringify(pub)).not.toContain("bcrypt$hash");
    const server = await db.as<{ password_hash: string }>("service_role", null, `SELECT * FROM get_shared_map_auth('rev-1')`);
    expect(server[0]!.password_hash).toBe("bcrypt$hash");
    await expect(db.as("anon", null, `SELECT * FROM get_shared_map_auth('rev-1')`)).rejects.toThrow(/permission denied/);
    await expect(db.as("authenticated", ids.userA, `SELECT * FROM get_shared_map_auth('rev-1')`)).rejects.toThrow(/permission denied/);
  });

  it("stops resolving once revoked, and only the creator can revoke", async () => {
    const byB = await db.as("authenticated", ids.userB, `UPDATE shared_maps SET revoked_at = now() WHERE slug = 'rev-1' RETURNING id`);
    expect(byB).toHaveLength(0);
    expect(await db.as("anon", null, `SELECT * FROM get_shared_map('rev-1')`)).toHaveLength(1);
    const byA = await db.as("authenticated", ids.userA, `UPDATE shared_maps SET revoked_at = now() WHERE slug = 'rev-1' RETURNING id`);
    expect(byA).toHaveLength(1);
    expect(await db.as("anon", null, `SELECT * FROM get_shared_map('rev-1')`)).toHaveLength(0);
  });

  it("does not let the creator change what the link points at, or its password", async () => {
    await expect(db.as("authenticated", ids.userA, `UPDATE shared_maps SET snapshot_id = $1 WHERE slug = 'rev-1'`, [s.snapB])).rejects.toThrow(/permission denied/);
    await expect(db.as("authenticated", ids.userA, `UPDATE shared_maps SET password_hash = NULL WHERE slug = 'rev-1'`)).rejects.toThrow(/permission denied/);
  });

  it("keeps an access log that only the creator can read and only the server can write", async () => {
    const id = (await db.admin<{ id: string }>(`SELECT id FROM shared_maps WHERE slug = 'rev-1'`))[0]!.id;
    await db.as("service_role", null, `INSERT INTO shared_map_access (shared_map_id, ip_hash, outcome) VALUES ($1, 'h', 'revoked')`, [id]);
    expect(await db.as("authenticated", ids.userA, `SELECT * FROM shared_map_access`)).toHaveLength(1);
    expect(await db.as("authenticated", ids.userB, `SELECT * FROM shared_map_access`)).toHaveLength(0);
    await expect(db.as("anon", null, `INSERT INTO shared_map_access (shared_map_id, outcome) VALUES ($1, 'ok')`, [id])).rejects.toThrow();
    await expect(db.as("authenticated", ids.userA, `INSERT INTO shared_map_access (shared_map_id, outcome) VALUES ($1, 'ok')`, [id])).rejects.toThrow();
  });
});

describe("job kinds", () => {
  it("hands a worker the kind and payload of the claimed job", async () => {
    await db.admin(`DELETE FROM scan_logs`);
    await db.admin(`INSERT INTO scan_logs (repo_id, triggered_by, kind, payload) VALUES ($1, 'webhook', 'pr_check', '{"pr":7}')`, [s.repoA]);
    const [job] = await db.as<{ kind: string; payload: { pr: number } }>("service_role", null, `SELECT * FROM claim_scan_job()`);
    expect(job).toMatchObject({ kind: "pr_check", payload: { pr: 7 } });
    await expect(db.admin(`INSERT INTO scan_logs (repo_id, triggered_by, kind) VALUES ($1, 'manual', 'bogus')`, [s.repoA])).rejects.toThrow();
  });

  it("one drift event per PR head commit", async () => {
    await expect(
      db.admin(`INSERT INTO drift_events (repo_id, pr_number, head_sha, head_graph_hash, conclusion) VALUES ($1, 7, 'abc', $2, 'success')`, [s.repoA, HASH])
    ).rejects.toThrow();
    expect(driftA).toBeTruthy();
  });
});
