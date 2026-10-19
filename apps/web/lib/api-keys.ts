import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** `tmk_` + 8 hex characters (the visible prefix) + 43 characters of URL-safe randomness. */
const KEY_PATTERN = /^tmk_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface GeneratedKey {
  /** The full key. Shown to the person once and never stored. */
  key: string;
  /** First part of the key, stored and shown in lists so keys can be told apart. */
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const id = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const key = `tmk_${id}_${secret}`;
  return { key, prefix: `tmk_${id}`, hash: hashApiKey(key) };
}

export type ApiAuth =
  | { ok: true; orgId: string; keyId: string }
  | { ok: false; response: NextResponse };

const unauthorized = (message = "Invalid or missing API key") => ({
  ok: false as const,
  response: NextResponse.json({ error: message }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } }),
});

/** Authenticate `Authorization: Bearer tmk_...` against the stored hashes. Pass a service-role client. */
export async function authenticateApiKey(req: Request, admin: SupabaseClient): Promise<ApiAuth> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || !KEY_PATTERN.test(match[1]!)) return unauthorized();

  const { data, error } = await admin.rpc("lookup_api_key", { p_hash: hashApiKey(match[1]!) });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return unauthorized();
  return { ok: true, orgId: row.org_id as string, keyId: row.id as string };
}

/** Confirm a repo belongs to the key's organisation. A repo in another org looks like a missing one. */
export async function repoForKey(admin: SupabaseClient, auth: { orgId: string }, repoId: string) {
  const { data } = await admin.from("repos").select("id, full_name, default_branch, org_id").eq("id", repoId).eq("org_id", auth.orgId).maybeSingle();
  return data as { id: string; full_name: string; default_branch: string; org_id: string } | null;
}
