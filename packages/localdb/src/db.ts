import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import * as fs from "node:fs";
import * as path from "node:path";

export type Role = "anon" | "authenticated" | "service_role";

export interface LocalDb {
  pg: PGlite;
  /** Run SQL as a Supabase role. `userId` sets auth.uid() for the transaction. */
  as<T = Record<string, unknown>>(role: Role, userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL as the superuser (setup only). */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Minimal stand-in for Supabase's auth schema and roles. */
export const AUTH_SHIM_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
`;

/** Find supabase/migrations by walking up from the working directory. */
export function findMigrationsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "supabase", "migrations");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find supabase/migrations (run from inside the repository)");
}

export interface CreateOptions {
  /** Directory to persist the database in. Omit for an in-memory database. */
  dataDir?: string;
  migrationsDir?: string;
}

/** A Postgres with the real schema, RLS policies and functions applied. */
export async function createLocalDb(options: CreateOptions = {}): Promise<LocalDb> {
  const pg = await PGlite.create({ ...(options.dataDir ? { dataDir: options.dataDir } : {}), extensions: { uuid_ossp } });
  const existing = await pg.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'repos'`
  );
  if (existing.rows[0]?.n !== "1") {
    await pg.exec(AUTH_SHIM_SQL);
    const dir = options.migrationsDir ?? findMigrationsDir();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await pg.exec(fs.readFileSync(path.join(dir, file), "utf8"));
    }
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
