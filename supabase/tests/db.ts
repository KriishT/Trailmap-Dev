import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

export type Role = "anon" | "authenticated" | "service_role";

export interface TestDb {
  pg: PGlite;
  /** Run SQL as a Supabase role. `userId` sets auth.uid() for the transaction. */
  as<T = Record<string, unknown>>(
    role: Role,
    userId: string | null,
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;
  /** Run SQL as the superuser (setup only). */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = await PGlite.create({ extensions: { uuid_ossp } });
  await pg.exec(fs.readFileSync(path.join(here, "auth-shim.sql"), "utf8"));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await pg.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  }

  return {
    pg,
    async admin(sql, params) {
      const res = await pg.query(sql, params);
      return res.rows as never;
    },
    async as(role, userId, sql, params) {
      return pg.transaction(async (tx) => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
        const res = await tx.query(sql, params);
        return res.rows as never;
      });
    },
  };
}

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
