import { createLocalDb, adminClient, anonClient, userClient, type LocalDb } from "@trailmap/localdb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedLocalDb } from "./local-seed";
import { isLocalMode } from "./local-mode";

const g = globalThis as { __trailmapLocalDb?: Promise<LocalDb> };

/** One database per server process, created and seeded on first use. Set TRAILMAP_LOCAL_DB_DIR to keep it between restarts. */
export function getLocalDb(): Promise<LocalDb> {
  if (!isLocalMode()) throw new Error("Local mode is not enabled");
  if (!g.__trailmapLocalDb) {
    g.__trailmapLocalDb = (async () => {
      const db = await createLocalDb({ dataDir: process.env.TRAILMAP_LOCAL_DB_DIR });
      const seeded = await db.admin<{ n: string }>(`SELECT count(*)::text AS n FROM public.organizations`);
      if (seeded[0]?.n === "0") await seedLocalDb(db);
      return db;
    })();
  }
  return g.__trailmapLocalDb;
}

/** The adapter is shaped like supabase-js for the calls the app makes. */
const asSupabase = (client: unknown) => client as SupabaseClient;

// Synchronous factories: the clients await the database themselves, so callers need not.
export const localAdminClient = (): SupabaseClient => asSupabase(adminClient(getLocalDb()));
export const localAnonClient = (): SupabaseClient => asSupabase(anonClient(getLocalDb()));
export const localUserClient = (userId: string): SupabaseClient => asSupabase(userClient(getLocalDb(), userId));
