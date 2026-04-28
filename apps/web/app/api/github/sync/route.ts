import { NextResponse } from "next/server";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

interface GitHubRepoSummary {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
}

export async function GET() {
  const auth = await getAuthenticatedContext();
  if ("error" in auth) return auth.error;

  const { db, org, repos, githubUsername } = auth;
  const { data: existingRepos } = await db
    .from("repos")
    .select("github_repo_id, is_active")
    .eq("org_id", org.id);

  const selectedRepoIds = new Set(
    (existingRepos ?? [])
      .filter((repo) => repo.is_active)
      .map((repo) => repo.github_repo_id)
  );

  return NextResponse.json({
    ok: true,
    org: githubUsername,
    repos: repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      default_branch: repo.default_branch ?? "main",
      selected: selectedRepoIds.has(repo.id),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await getAuthenticatedContext();
  if ("error" in auth) return auth.error;

  const { db, org, repos, githubUsername } = auth;
  const body = await parseBody(req);
  const selectedRepoIds = new Set<number>(body.selectedRepoIds ?? repos.map((repo) => repo.id));

  for (const repo of repos) {
    await db.from("repos").upsert({
      org_id: org.id,
      github_repo_id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      default_branch: repo.default_branch ?? "main",
      is_active: selectedRepoIds.has(repo.id),
    }, { onConflict: "org_id,github_repo_id" });
  }

  const inactiveRepoIds = repos
    .filter((repo) => !selectedRepoIds.has(repo.id))
    .map((repo) => repo.id);

  if (inactiveRepoIds.length > 0) {
    await db
      .from("repos")
      .update({ is_active: false })
      .eq("org_id", org.id)
      .not("github_repo_id", "in", `(${repos.map((repo) => repo.id).join(",")})`);
  }

  return NextResponse.json({
    ok: true,
    selected: selectedRepoIds.size,
    available: repos.length,
    org: githubUsername,
  });
}

async function getAuthenticatedContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const db = supabaseAdmin();
  const appId = process.env.GITHUB_APP_ID!;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const githubUsername = user.user_metadata?.user_name || user.user_metadata?.preferred_username;

  if (!githubUsername) {
    return {
      error: NextResponse.json(
        { error: "Could not find GitHub username. Please sign out and sign back in." },
        { status: 400 }
      ),
    };
  }

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  });

  const { data: installations } = await appOctokit.apps.listInstallations({ per_page: 100 });
  const userInstallation = installations.find(
    (installation: any) => installation.account?.login?.toLowerCase() === githubUsername.toLowerCase()
  );

  if (!userInstallation) {
    return {
      error: NextResponse.json(
        { error: `No installation found for @${githubUsername}. Make sure you installed the Trailmap GitHub App.` },
        { status: 404 }
      ),
    };
  }

  const installationId = userInstallation.id;

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
    return { error: NextResponse.json({ error: `DB error: ${orgErr?.message}` }, { status: 500 }) };
  }

  const installOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });

  const { data: reposData } = await installOctokit.apps.listReposAccessibleToInstallation({ per_page: 100 });

  const repos: GitHubRepoSummary[] = reposData.repositories.map((repo) => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    private: repo.private,
    default_branch: repo.default_branch ?? "main",
  }));

  return { db, org, repos, githubUsername };
}

async function parseBody(req: Request): Promise<{ selectedRepoIds?: number[] }> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
