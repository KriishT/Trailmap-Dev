import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { notLocal } from "@/lib/local-guard";
import { LOCAL_COOKIE, LOCAL_USERS, localUserFromCookie } from "@/lib/local-mode";
import { getLocalDb, localAdminClient } from "@/lib/local-db";

const COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 };

/** Who am I in local mode? */
export async function GET() {
  const blocked = notLocal();
  if (blocked) return blocked;
  const id = localUserFromCookie((await cookies()).get(LOCAL_COOKIE)?.value);
  if (!id) return NextResponse.json({ user: null });
  const { data } = await localAdminClient().from("users").select("id, email, name").eq("id", id).maybeSingle();
  return NextResponse.json({ user: data ?? null });
}

/** Sign in as one of the demo accounts, or create a new account (sign up). */
export async function POST(req: Request) {
  const blocked = notLocal();
  if (blocked) return blocked;
  const body = await req.json().catch(() => ({}));

  let userId: string | undefined;
  if (typeof body?.user === "string" && LOCAL_USERS[body.user]) {
    userId = LOCAL_USERS[body.user]!.id;
  } else if (typeof body?.email === "string" && /^[^@\s]+@[^@\s]+$/.test(body.email)) {
    const db = localAdminClient();
    const email = body.email.toLowerCase();
    const { data: existing } = await db.from("users").select("id").eq("email", email).maybeSingle();
    if (existing) {
      userId = existing.id as string;
    } else {
      // The same trigger that runs on Supabase signup creates the public.users row.
      userId = crypto.randomUUID();
      const name = typeof body.name === "string" && body.name ? body.name.slice(0, 80) : email.split("@")[0];
      try {
        await (await getLocalDb()).admin(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [userId, email, JSON.stringify({ full_name: name, user_name: email.split("@")[0]!.replace(/[^a-z0-9-]/gi, "") })]);
      } catch {
        return NextResponse.json({ error: "Could not create the account" }, { status: 500 });
      }
    }
  }
  if (!userId) return NextResponse.json({ error: "Choose a demo user or give an email address" }, { status: 400 });

  const res = NextResponse.json({ ok: true, userId });
  res.cookies.set(LOCAL_COOKIE, userId, COOKIE_OPTIONS);
  return res;
}

export async function DELETE() {
  const blocked = notLocal();
  if (blocked) return blocked;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCAL_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
