import { NextResponse } from "next/server";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const appId = process.env.GITHUB_APP_ID!;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");

  // Get user GitHub username from their auth metadata
  const githubUsername = user.user_metadata?.user_name || user.user_metadata?.preferred_username;
  if (!githubUsername) {
    return NextResponse.json({ error: "Could not find GitHub username. Please sign out and sign back in." }, { status: 400 });
  }

  // Use the GitHub App to list all installations and find the one for this user
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  });

  const { data: installations } = await appOctokit.apps.listInstallations({ per_page: 100 });

  // Find installation matching this user
  const userInstallation = installations.find(
    (i: any) => i.account?.login?.toLowerCase() === githubUsername.toLowerCase()
  );

  if (!userInstallation) {
    return NextResponse.json({
      error: `No installation found for @${githubUsername}. Make sure you installed the Trailmap GitHub App.`
    }, { status: 404 });
  }

  const installationId = userInstallation.id;

  // Upsert org
  const { data: org, error: orgErr } = await db
    .from("organizations")
    .upsert({
      github_org_id: userInstallation.account?.id,
      github_org_name: githubUsername,
      github_installation_id: installationId,
      owner_user_id: user.id,
    }, { onConflict: "github_org_id" })
    .select("id")
    .single();

  if (orgErr || !org) {
    return NextResponse.json({ error: `DB error: ${orgErr?.message}` }, { status: 500 });
  }

  // Get repos for this installation
  const installOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });

  const { data: reposData } = await installOctokit.apps.listReposAccessibleToInstallation({ per_page: 100 });

  let count = 0;
  for (const repo of reposData.repositories) {
    await db.from("repos").upsert({
      org_id: org.id,
      github_repo_id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      default_branch: repo.default_branch ?? "main",
      is_active: true,
    }, { onConflict: "org_id,github_repo_id" });
    count++;
  }

  return NextResponse.json({ ok: true, repos: count, org: githubUsername });
}