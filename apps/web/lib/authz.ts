import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type AuthResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; response: NextResponse };

/** Resolve the signed-in user or a ready-made 401 response. */
export async function requireUser(): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, user, supabase };
}

export type RepoAccess =
  | { ok: true; user: User; supabase: SupabaseClient; repo: { id: string; org_id: string } }
  | { ok: false; response: NextResponse };

/**
 * Confirm the signed-in user can see this repo.
 *
 * The lookup runs through the user's own Supabase client, so row-level security
 * (membership of the repo's org) decides the answer. A repo that exists but belongs
 * to another org is indistinguishable from one that does not exist: both return 404.
 */
export async function requireRepoAccess(repoId: string): Promise<RepoAccess> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const notFound = {
    ok: false as const,
    response: NextResponse.json({ error: "Repo not found" }, { status: 404 }),
  };
  if (!isUuid(repoId)) return notFound;

  const { data: repo } = await auth.supabase
    .from("repos")
    .select("id, org_id")
    .eq("id", repoId)
    .maybeSingle();
  if (!repo) return notFound;

  return { ok: true, user: auth.user, supabase: auth.supabase, repo };
}
