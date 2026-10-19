import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { checkGithubSignature } from "@/lib/webhook-signature";
import { handleGithubEvent } from "@/lib/github-events";
import { githubApi } from "@/lib/github-api";
import { buildPrImpactComment, computePrImpactForRepo, upsertPrImpactComment } from "@/lib/github-pr-impact";

export async function POST(req: Request) {
  const body = await req.text();

  const signature = checkGithubSignature(
    process.env.GITHUB_WEBHOOK_SECRET,
    body,
    req.headers.get("x-hub-signature-256")
  );
  if (signature === "no-secret") {
    console.error("[trailmap] GITHUB_WEBHOOK_SECRET is not set; refusing all webhooks");
    return NextResponse.json({ error: "Webhook receiver is not configured" }, { status: 500 });
  }
  if (signature === "invalid") {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = req.headers.get("x-github-event");
  const db = supabaseAdmin();

  if (event === "pull_request") {
    await handlePullRequest(payload, db);
    return NextResponse.json({ ok: true });
  }

  const result = await handleGithubEvent(event, payload, { db, github: githubApi });
  return NextResponse.json({ ok: true, ...result });
}

async function handlePullRequest(payload: Record<string, any>, db: ReturnType<typeof supabaseAdmin>) {
  const action = payload.action;
  const prNumber = payload.pull_request?.number;
  const githubRepoId = payload.repository?.id;
  if (!["opened", "reopened", "synchronize"].includes(action) || !prNumber || !githubRepoId) return;

  const { data: repos } = await db
    .from("repos")
    .select("id, is_active")
    .eq("github_repo_id", githubRepoId);

  for (const repo of repos ?? []) {
    if (!repo.is_active) continue;
    const impact = await computePrImpactForRepo({ repoId: repo.id, prNumber });
    if (!impact.ok) {
      console.error("[trailmap] PR impact failed", impact.error);
      continue;
    }
    const commentBody = buildPrImpactComment({
      source: impact.source,
      snapshotCommit: impact.snapshotCommit,
      analysis: impact.analysis,
      trailmapUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      repoId: repo.id,
    });
    const commentResult = await upsertPrImpactComment({
      installationId: impact.installationId,
      fullName: impact.fullName,
      prNumber,
      body: commentBody,
    });
    if (!commentResult.ok) console.error("[trailmap] PR comment failed", commentResult.error);
  }
}

export const maxDuration = 60;
