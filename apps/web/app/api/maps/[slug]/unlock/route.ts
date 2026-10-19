import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { attemptUnlock, createUnlockToken, hashIp, unlockCookieName, UNLOCK_TTL_SECONDS } from "@/lib/share";
import { createRateLimiter } from "@/lib/rate-limit";

// Five password attempts per minute per visitor and link, to make guessing impractical.
const limiter = createRateLimiter(5, 60_000);

function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/** Check the password for a protected link and, if right, set a signed cookie that unlocks it for 12 hours. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const secret = process.env.SHARE_COOKIE_SECRET;
  if (!secret || secret.length < 16) {
    console.error("[trailmap] SHARE_COOKIE_SECRET is not set (16+ characters); password-protected links cannot be unlocked");
    return NextResponse.json({ error: "Password-protected links are not configured on this server" }, { status: 500 });
  }

  const ip = clientIp(req);
  if (!limiter.take(`${hashIp(ip, secret) ?? "unknown"}:${slug}`)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  const result = await attemptUnlock({ admin: supabaseAdmin(), ipSalt: secret }, slug, password, { ip, userAgent: req.headers.get("user-agent") });

  if (result === "notfound" || result === "gone") return NextResponse.json({ error: "This link is not available" }, { status: 404 });
  if (result === "bad_password") return NextResponse.json({ error: "Incorrect password" }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(unlockCookieName(slug), createUnlockToken(secret, slug), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: `/map/${slug}`, maxAge: UNLOCK_TTL_SECONDS,
  });
  return res;
}
