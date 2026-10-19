import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, ids, seedTwoOrgs, type TestDb } from "../../../../supabase/tests/db";
import { adminClient, anonClient, userClient } from "../../../../supabase/tests/pg-client";

const SECRET = "test-share-secret-0123456789";
const state = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => {
    const db = state.db as TestDb;
    return state.userId ? userClient(db, state.userId) : anonClient(db);
  },
  supabaseAdmin: () => adminClient(state.db as TestDb),
}));

import { POST as share } from "./maps/share/route";
import { POST as revoke } from "./maps/[slug]/revoke/route";
import { POST as unlock } from "./maps/[slug]/unlock/route";
import { GET as accessLog } from "./maps/[slug]/access-log/route";
import { attemptUnlock, createUnlockToken, hashIp, resolveShare, unlockCookieName, verifyUnlockToken, verifyPassword, hashPassword } from "@/lib/share";
import { createRateLimiter } from "@/lib/rate-limit";

let db: TestDb;
let s: Awaited<ReturnType<typeof seedTwoOrgs>>;

const asUser = (id: string | null) => { state.userId = id; };
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const rows = <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => db.admin<T>(sql, args);
const deps = () => ({ anon: anonClient(db) as never, admin: adminClient(db) as never, cookieSecret: SECRET });

async function newLink(body: Record<string, unknown> = {}): Promise<string> {
  asUser(ids.userA);
  const res = await share(json({ snapshotId: s.snapA, ...body }));
  expect(res.status).toBe(200);
  return (await res.json()).slug as string;
}

beforeAll(async () => {
  db = await createTestDb();
  state.db = db;
  s = await seedTwoOrgs(db);
  await db.admin(`UPDATE graph_snapshots SET raw_json = $2, node_count = 2, edge_count = 1 WHERE id = $1`, [s.snapA, JSON.stringify({
    meta: { repo: "org-a/a", scanned_at: "t", language_breakdown: {}, total_files: 1 },
    nodes: [{ id: "a", name: "a", type: "service", language: "unknown", port: null, endpoints: [], path: "a" }, { id: "b", name: "b", type: "service", language: "unknown", port: null, endpoints: [], path: "b" }],
    edges: [{ from: "a", to: "b", type: "http", confidence: "high" }],
  })]);
  vi.stubEnv("SHARE_COOKIE_SECRET", SECRET);
});
afterAll(async () => {
  await db.pg.close();
});
beforeEach(() => {
  asUser(null);
  vi.stubEnv("SHARE_COOKIE_SECRET", SECRET);
});

describe("creating a link", () => {
  it("reuses one plain link per snapshot, but makes a new link for each set of options", async () => {
    const a = await newLink();
    expect(await newLink()).toBe(a);
    expect(a).toMatch(/^[\w-]{16}$/);
    const b = await newLink({ label: "Acme auditors" });
    expect(b).not.toBe(a);
  });

  it("stores a bcrypt hash, never the password, and an expiry and label", async () => {
    const slug = await newLink({ password: "correct horse", expiresInDays: 7, label: "Acme auditors" });
    const row = (await rows<{ password_hash: string; expires_at: string; label: string }>(`SELECT password_hash, expires_at, label FROM shared_maps WHERE slug = $1`, [slug]))[0]!;
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row.password_hash).not.toContain("correct horse");
    expect(row.label).toBe("Acme auditors");
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect((await rows(`SELECT 1 FROM audit_events WHERE action = 'share_link.created'`)).length).toBeGreaterThan(0);
  });

  it("validates options and refuses other orgs' snapshots", async () => {
    asUser(ids.userA);
    expect((await share(json({ snapshotId: s.snapA, password: "short" }))).status).toBe(400);
    expect((await share(json({ snapshotId: s.snapA, expiresInDays: 0 }))).status).toBe(400);
    expect((await share(json({ snapshotId: s.snapA, expiresInDays: 400 }))).status).toBe(400);
    expect((await share(json({ snapshotId: s.snapA, expiresInDays: 1.5 }))).status).toBe(400);
    expect((await share(json({ snapshotId: s.snapB }))).status).toBe(404);
    asUser(null);
    expect((await share(json({ snapshotId: s.snapA }))).status).toBe(401);
  });
});

describe("what a visitor sees", () => {
  it("serves an open link and logs the visit with a hashed address", async () => {
    const slug = await newLink({ label: "For Acme" });
    const r = await resolveShare(deps(), slug, { ip: "203.0.113.9", userAgent: "UA/1" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.view).toMatchObject({ repoFullName: "org-a/a", nodeCount: 2, label: "For Acme" });
    const log = (await rows<{ outcome: string; ip_hash: string; user_agent: string }>(`SELECT l.outcome, l.ip_hash, l.user_agent FROM shared_map_access l JOIN shared_maps m ON m.id = l.shared_map_id WHERE m.slug = $1`, [slug]))[0]!;
    expect(log).toMatchObject({ outcome: "ok", user_agent: "UA/1" });
    expect(log.ip_hash).toBe(hashIp("203.0.113.9", SECRET));
    expect(log.ip_hash).not.toContain("203.0.113.9");
  });

  it("treats an unknown slug as not found, without logging", async () => {
    expect(await resolveShare(deps(), "does-not-exist")).toEqual({ status: "notfound" });
  });

  it("asks for the password, and accepts only a cookie signed for that slug", async () => {
    const slug = await newLink({ password: "correct horse" });
    expect(await resolveShare(deps(), slug)).toEqual({ status: "password" });
    expect(await resolveShare(deps(), slug, { cookie: "garbage" })).toEqual({ status: "password" });
    expect((await resolveShare(deps(), slug, { cookie: createUnlockToken(SECRET, "another-slug") })).status).toBe("password");
    expect((await resolveShare(deps(), slug, { cookie: createUnlockToken("a-different-secret-xxxxxxxx", slug) })).status).toBe("password");
    expect((await resolveShare(deps(), slug, { cookie: createUnlockToken(SECRET, slug) })).status).toBe("ok");
  });

  it("does not hand out a password-protected map when the cookie secret is not configured", async () => {
    const slug = await newLink({ password: "correct horse" });
    const noSecret = { ...deps(), cookieSecret: undefined };
    expect((await resolveShare(noSecret, slug, { cookie: createUnlockToken(SECRET, slug) })).status).toBe("password");
  });

  it("reports expired and revoked links as gone, and logs why", async () => {
    const slug = await newLink({ expiresInDays: 1 });
    await db.admin(`UPDATE shared_maps SET expires_at = now() - interval '1 minute' WHERE slug = $1`, [slug]);
    expect(await resolveShare(deps(), slug)).toEqual({ status: "gone", reason: "expired" });

    const slug2 = await newLink({ label: "to revoke" });
    asUser(ids.userA);
    expect((await revoke(new Request("http://x"), params({ slug: slug2 }))).status).toBe(200);
    expect(await resolveShare(deps(), slug2)).toEqual({ status: "gone", reason: "revoked" });
    const outcomes = (await rows<{ outcome: string }>(`SELECT l.outcome FROM shared_map_access l JOIN shared_maps m ON m.id = l.shared_map_id WHERE m.slug IN ($1, $2) ORDER BY l.outcome`, [slug, slug2])).map((r) => r.outcome);
    expect(outcomes).toEqual(["expired", "revoked"]);
  });
});

describe("revoking and the access log", () => {
  it("only the creator can revoke, and a link cannot be revoked twice", async () => {
    const slug = await newLink({ label: "r1" });
    asUser(ids.userB);
    expect((await revoke(new Request("http://x"), params({ slug }))).status).toBe(404);
    asUser(null);
    expect((await revoke(new Request("http://x"), params({ slug }))).status).toBe(401);
    asUser(ids.userA);
    expect((await revoke(new Request("http://x"), params({ slug }))).status).toBe(200);
    expect((await revoke(new Request("http://x"), params({ slug }))).status).toBe(404);
    expect((await rows(`SELECT 1 FROM audit_events WHERE action = 'share_link.revoked'`)).length).toBeGreaterThan(0);
  });

  it("shows the access log to the creator only", async () => {
    const slug = await newLink({ label: "logged" });
    await resolveShare(deps(), slug, { ip: "198.51.100.1" });
    asUser(ids.userA);
    const mine = await (await accessLog(new Request("http://x"), params({ slug }))).json();
    expect(mine.entries).toHaveLength(1);
    expect(mine.entries[0].outcome).toBe("ok");
    asUser(ids.userB);
    expect((await accessLog(new Request("http://x"), params({ slug }))).status).toBe(404);
    asUser(null);
    expect((await accessLog(new Request("http://x"), params({ slug }))).status).toBe(401);
  });
});

describe("unlocking with a password", () => {
  it("sets a signed, HttpOnly cookie scoped to the link when the password is right", async () => {
    const slug = await newLink({ password: "correct horse" });
    const res = await unlock(json({ password: "correct horse" }, { "x-forwarded-for": "192.0.2.50" }), params({ slug }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${unlockCookieName(slug)}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toContain(`Path=/map/${slug}`);
    const token = decodeURIComponent(cookie.split(";")[0]!.split("=").slice(1).join("="));
    expect(verifyUnlockToken(SECRET, slug, token)).toBe(true);
    expect((await resolveShare(deps(), slug, { cookie: token })).status).toBe("ok");
  });

  it("rejects a wrong password, logs it, and rate-limits guessing", async () => {
    const slug = await newLink({ password: "correct horse" });
    const attempt = (pw: string) => unlock(json({ password: pw }, { "x-forwarded-for": "192.0.2.77" }), params({ slug }));
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await attempt("wrong")).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
    const bad = await rows(`SELECT 1 FROM shared_map_access l JOIN shared_maps m ON m.id = l.shared_map_id WHERE m.slug = $1 AND l.outcome = 'bad_password'`, [slug]);
    expect(bad).toHaveLength(5);
    // a different visitor is not locked out by this one
    expect((await unlock(json({ password: "correct horse" }, { "x-forwarded-for": "192.0.2.78" }), params({ slug }))).status).toBe(200);
  });

  it("fails closed when the cookie secret is missing or weak", async () => {
    const slug = await newLink({ password: "correct horse" });
    vi.stubEnv("SHARE_COOKIE_SECRET", "");
    expect((await unlock(json({ password: "correct horse" }), params({ slug }))).status).toBe(500);
    vi.stubEnv("SHARE_COOKIE_SECRET", "short");
    expect((await unlock(json({ password: "correct horse" }), params({ slug }))).status).toBe(500);
  });

  it("does not unlock unknown, revoked or unprotected links", async () => {
    expect((await unlock(json({ password: "x" }, { "x-forwarded-for": "192.0.2.90" }), params({ slug: "nope" }))).status).toBe(404);
    const open = await newLink({ label: "unprotected" });
    expect(await attemptUnlock({ admin: adminClient(db) as never, ipSalt: SECRET }, open, "x", {})).toBe("not_protected");
    const gone = await newLink({ password: "correct horse", expiresInDays: 1 });
    asUser(ids.userA);
    await revoke(new Request("http://x"), params({ slug: gone }));
    expect((await unlock(json({ password: "correct horse" }, { "x-forwarded-for": "192.0.2.91" }), params({ slug: gone }))).status).toBe(404);
  });
});

describe("primitives", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", h)).toBe(true);
    expect(await verifyPassword("nope", h)).toBe(false);
  });

  it("expires unlock tokens and rejects tampering", () => {
    const now = Date.UTC(2026, 0, 1);
    const t = createUnlockToken(SECRET, "slug", now);
    expect(verifyUnlockToken(SECRET, "slug", t, now + 60_000)).toBe(true);
    expect(verifyUnlockToken(SECRET, "slug", t, now + 13 * 3600_000)).toBe(false);
    expect(verifyUnlockToken(SECRET, "slug", t.replace(/.$/, "x"), now)).toBe(false);
    expect(verifyUnlockToken(SECRET, "slug", null, now)).toBe(false);
    expect(verifyUnlockToken(undefined, "slug", t, now)).toBe(false);
    expect(hashIp(null, "s")).toBeNull();
  });

  it("the rate limiter allows a budget per key per window", () => {
    const rl = createRateLimiter(2, 1000);
    expect([rl.take("a", 0), rl.take("a", 10), rl.take("a", 20), rl.take("b", 20)]).toEqual([true, true, false, true]);
    expect(rl.take("a", 1500)).toBe(true);
  });
});
