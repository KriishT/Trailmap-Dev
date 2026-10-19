import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { notLocal } from "@/lib/local-guard";
import { githubStore, resetGithubStore } from "@/lib/local-github";
import { LOCAL_COOKIE, localUserFromCookie } from "@/lib/local-mode";
import { localAdminClient } from "@/lib/local-db";

/** What the mocked GitHub has recorded: check runs and pull request comments. */
export async function GET() {
  const blocked = notLocal();
  if (blocked) return blocked;
  const { checkRuns, comments } = githubStore();
  return NextResponse.json({ checkRuns, comments });
}

export async function DELETE() {
  const blocked = notLocal();
  if (blocked) return blocked;
  resetGithubStore();
  return NextResponse.json({ ok: true });
}

let nextInstallation = 7000;

/** Simulate installing the GitHub App for the signed-in user: creates their organisation. */
export async function POST() {
  const blocked = notLocal();
  if (blocked) return blocked;
  const userId = localUserFromCookie((await cookies()).get(LOCAL_COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = localAdminClient();
  const { data: existing } = await db.from("organizations").select("id, github_org_name").eq("owner_user_id", userId).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, org: existing.github_org_name, alreadyInstalled: true });

  const { data: user } = await db.from("users").select("email").eq("id", userId).maybeSingle();
  const handle = String(user?.email ?? "user").split("@")[0]!.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "user";
  const installationId = ++nextInstallation;
  const { error } = await db.from("organizations").insert({ github_org_id: installationId, github_org_name: handle, github_installation_id: installationId, owner_user_id: userId });
  if (error) return NextResponse.json({ error: "Could not install" }, { status: 500 });
  return NextResponse.json({ ok: true, org: handle });
}
