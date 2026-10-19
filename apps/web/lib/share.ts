import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST = 10;
export const UNLOCK_TTL_SECONDS = 12 * 60 * 60;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const unlockCookieName = (slug: string) => `tm_share_${slug}`;

function sign(secret: string, slug: string, exp: number): string {
  return createHmac("sha256", secret).update(`${slug}.${exp}`).digest("base64url");
}

/** A short-lived proof that someone entered the right password for this slug. Tied to the slug and an expiry. */
export function createUnlockToken(secret: string, slug: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + UNLOCK_TTL_SECONDS;
  return `${exp}.${sign(secret, slug, exp)}`;
}

export function verifyUnlockToken(secret: string | undefined, slug: string, token: string | undefined | null, now = Date.now()): boolean {
  if (!secret || !token) return false;
  const [expRaw, mac] = token.split(".");
  const exp = Number(expRaw);
  if (!mac || !Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(secret, slug, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A salted hash of the visitor's address for the access log: enough to spot repeat visitors, not to identify them. */
export function hashIp(ip: string | null | undefined, salt: string): string | null {
  return ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32) : null;
}

export type ShareAccess =
  | { status: "ok"; view: { snapshotId: string; repoFullName: string; nodeCount: number; edgeCount: number; scannedAt: string; graphRaw: unknown; label: string | null } }
  | { status: "password" }
  | { status: "gone"; reason: "expired" | "revoked" }
  | { status: "notfound" };

export interface ShareVisitor {
  cookie?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

type Outcome = "ok" | "bad_password" | "expired" | "revoked";

async function logAccess(admin: SupabaseClient, mapId: string, outcome: Outcome, v: ShareVisitor, salt: string) {
  await admin.from("shared_map_access").insert({
    shared_map_id: mapId, outcome, ip_hash: hashIp(v.ip, salt), user_agent: v.userAgent?.slice(0, 200) ?? null,
  });
}

/**
 * Decide what a visitor to /map/[slug] may see, and record the visit. `anon` is the public
 * client (it can only call the slug resolver); `admin` is used to tell an expired or revoked link
 * from one that never existed, and to write the access log.
 */
export async function resolveShare(
  deps: { anon: SupabaseClient; admin: SupabaseClient; cookieSecret?: string; ipSalt?: string },
  slug: string,
  visitor: ShareVisitor = {}
): Promise<ShareAccess> {
  const salt = deps.ipSalt ?? deps.cookieSecret ?? "trailmap";
  const { data: auth } = await deps.admin.rpc("get_shared_map_auth", { p_slug: slug });
  const meta = Array.isArray(auth) ? auth[0] : null;
  if (!meta) return { status: "notfound" };

  if (meta.revoked_at) {
    await logAccess(deps.admin, meta.id, "revoked", visitor, salt);
    return { status: "gone", reason: "revoked" };
  }
  if (meta.expires_at && new Date(meta.expires_at) <= new Date()) {
    await logAccess(deps.admin, meta.id, "expired", visitor, salt);
    return { status: "gone", reason: "expired" };
  }
  if (meta.password_hash && !verifyUnlockToken(deps.cookieSecret, slug, visitor.cookie)) {
    return { status: "password" };
  }

  const { data } = await deps.anon.rpc("get_shared_map", { p_slug: slug });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { status: "notfound" };

  await logAccess(deps.admin, meta.id, "ok", visitor, salt);
  return {
    status: "ok",
    view: {
      snapshotId: row.snapshot_id, repoFullName: row.repo_full_name, nodeCount: row.node_count, edgeCount: row.edge_count,
      scannedAt: row.scanned_at, graphRaw: row.raw_json, label: row.label ?? null,
    },
  };
}

/** Check a password attempt for a protected link and log the outcome. */
export async function attemptUnlock(
  deps: { admin: SupabaseClient; ipSalt: string },
  slug: string,
  password: string,
  visitor: ShareVisitor
): Promise<"ok" | "bad_password" | "gone" | "notfound" | "not_protected"> {
  const { data: auth } = await deps.admin.rpc("get_shared_map_auth", { p_slug: slug });
  const meta = Array.isArray(auth) ? auth[0] : null;
  if (!meta) return "notfound";
  if (meta.revoked_at || (meta.expires_at && new Date(meta.expires_at) <= new Date())) return "gone";
  if (!meta.password_hash) return "not_protected";
  const ok = await verifyPassword(password, meta.password_hash);
  await logAccess(deps.admin, meta.id, ok ? "ok" : "bad_password", visitor, deps.ipSalt);
  return ok ? "ok" : "bad_password";
}
