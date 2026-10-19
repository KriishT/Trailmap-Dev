import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, ids, seedTwoOrgs, type TestDb } from "./db";

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;

beforeAll(async () => {
  db = await createTestDb();
  s = await seedTwoOrgs(db);
});
afterAll(async () => {
  await db.pg.close();
});

describe("org ownership", () => {
  it("adds the owner as an org member via trigger", async () => {
    const rows = await db.admin<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM org_members WHERE org_id = $1`,
      [s.orgA]
    );
    expect(rows).toEqual([{ user_id: ids.userA, role: "owner" }]);
  });
});

describe("tenant isolation", () => {
  it("user A sees only org A's repos and snapshots", async () => {
    const repos = await db.as<{ id: string }>("authenticated", ids.userA, `SELECT id FROM repos`);
    expect(repos.map((r) => r.id)).toEqual([s.repoA]);
    const snaps = await db.as<{ id: string }>("authenticated", ids.userA, `SELECT id FROM graph_snapshots`);
    expect(snaps.map((r) => r.id)).toEqual([s.snapA]);
  });

  it("user A cannot insert a repo into org B", async () => {
    await expect(
      db.as(
        "authenticated",
        ids.userA,
        `INSERT INTO repos (org_id, github_repo_id, name, full_name) VALUES ($1, 99, 'x', 'org-b/x')`,
        [s.orgB]
      )
    ).rejects.toThrow();
  });

  it("anon sees nothing in tenant tables", async () => {
    for (const table of ["repos", "graph_snapshots", "organizations", "scan_logs", "org_members"]) {
      const rows = await db.as("anon", null, `SELECT 1 FROM ${table}`);
      expect(rows, table).toHaveLength(0);
    }
  });
});

describe("shared maps", () => {
  beforeAll(async () => {
    await db.admin(
      `INSERT INTO shared_maps (snapshot_id, slug, password_hash, created_by) VALUES ($1, 'slug-b', 'hash-secret', $2)`,
      [s.snapB, ids.userB]
    );
    await db.admin(
      `INSERT INTO shared_maps (snapshot_id, slug, created_by, expires_at) VALUES ($1, 'slug-expired', $2, now() - interval '1 day')`,
      [s.snapA, ids.userA]
    );
  });

  it("anon cannot list shared_maps", async () => {
    await expect(db.as("anon", null, `SELECT * FROM shared_maps`)).rejects.toThrow(/permission denied/);
  });

  it("authenticated users cannot read password_hash, even their own", async () => {
    await expect(
      db.as("authenticated", ids.userB, `SELECT password_hash FROM shared_maps`)
    ).rejects.toThrow(/permission denied/);
  });

  it("another user cannot see someone else's shared map rows", async () => {
    const rows = await db.as<{ slug: string }>("authenticated", ids.userA, `SELECT slug FROM shared_maps`);
    expect(rows.map((r) => r.slug)).not.toContain("slug-b");
  });

  it("anon can resolve exactly one slug and sees a boolean, not the hash", async () => {
    const rows = await db.as<Record<string, unknown>>("anon", null, `SELECT * FROM get_shared_map('slug-b')`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requires_password).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain("hash-secret");
  });

  it("expired and unknown slugs resolve to nothing", async () => {
    expect(await db.as("anon", null, `SELECT * FROM get_shared_map('slug-expired')`)).toHaveLength(0);
    expect(await db.as("anon", null, `SELECT * FROM get_shared_map('nope')`)).toHaveLength(0);
  });

  it("a user cannot create a share link for another org's snapshot", async () => {
    await expect(
      db.as(
        "authenticated",
        ids.userA,
        `INSERT INTO shared_maps (snapshot_id, slug, created_by) VALUES ($1, 'steal', $2)`,
        [s.snapB, ids.userA]
      )
    ).rejects.toThrow();
  });

  it("a user can share their own org's snapshot", async () => {
    await db.as(
      "authenticated",
      ids.userA,
      `INSERT INTO shared_maps (snapshot_id, slug, created_by) VALUES ($1, 'mine', $2)`,
      [s.snapA, ids.userA]
    );
    const rows = await db.as<{ repo_full_name: string }>("anon", null, `SELECT repo_full_name FROM get_shared_map('mine')`);
    expect(rows).toEqual([{ repo_full_name: "org-a/a" }]);
  });
});

describe("claim_scan_job", () => {
  it("is not callable by anon or authenticated users", async () => {
    await expect(db.as("anon", null, `SELECT * FROM claim_scan_job()`)).rejects.toThrow(/permission denied/);
    await expect(db.as("authenticated", ids.userA, `SELECT * FROM claim_scan_job()`)).rejects.toThrow(/permission denied/);
  });

  it("hands one pending job to exactly one claimer", async () => {
    await db.admin(`INSERT INTO scan_logs (repo_id, triggered_by) VALUES ($1, 'manual')`, [s.repoA]);
    const first = await db.as<{ id: string }>("service_role", null, `SELECT * FROM claim_scan_job()`);
    const second = await db.as<{ id: string }>("service_role", null, `SELECT * FROM claim_scan_job()`);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
