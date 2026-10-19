import { createLocalDb, type LocalDb, type Role } from "../../packages/localdb/src/db";

export type { Role };
export type TestDb = LocalDb;

export const createTestDb = () => createLocalDb();

export const ids = {
  userA: "00000000-0000-0000-0000-00000000000a",
  userB: "00000000-0000-0000-0000-00000000000b",
};

async function one(db: TestDb, sql: string, params: unknown[]): Promise<string> {
  return (await db.admin<{ id: string }>(sql, params))[0]!.id;
}

/** Two users, each owning one org with one repo and one snapshot. */
export async function seedTwoOrgs(db: TestDb) {
  await db.admin(
    `INSERT INTO auth.users (id, email) VALUES ($1, 'a@example.com'), ($2, 'b@example.com')`,
    [ids.userA, ids.userB]
  );
  const orgA = await one(db, `INSERT INTO organizations (github_org_name, github_org_id, owner_user_id) VALUES ('org-a', 1, $1) RETURNING id`, [ids.userA]);
  const orgB = await one(db, `INSERT INTO organizations (github_org_name, github_org_id, owner_user_id) VALUES ('org-b', 2, $1) RETURNING id`, [ids.userB]);
  const repoA = await one(db, `INSERT INTO repos (org_id, github_repo_id, name, full_name) VALUES ($1, 10, 'a', 'org-a/a') RETURNING id`, [orgA]);
  const repoB = await one(db, `INSERT INTO repos (org_id, github_repo_id, name, full_name) VALUES ($1, 20, 'b', 'org-b/b') RETURNING id`, [orgB]);
  const snapA = await one(db, `INSERT INTO graph_snapshots (repo_id, raw_json) VALUES ($1, '{"nodes":[],"edges":[]}') RETURNING id`, [repoA]);
  const snapB = await one(db, `INSERT INTO graph_snapshots (repo_id, raw_json) VALUES ($1, '{"nodes":[],"edges":[]}') RETURNING id`, [repoB]);
  return { orgA, orgB, repoA, repoB, snapA, snapB };
}
