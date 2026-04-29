import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { scanRepo } from "@/lib/scan";
import { buildPrImpactComment, computePrImpactForRepo, upsertPrImpactComment } from "@/lib/github-pr-impact";

function verifySignature(payload: string, signature: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";

  if (!verifySignature(body, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  const payload = JSON.parse(body);
  const db = supabaseAdmin();

  if (event === "push") {
    const branch = payload.ref?.replace("refs/heads/", "");
    const defaultBranch = payload.repository?.default_branch;

    if (branch !== defaultBranch) {
      return NextResponse.json({ ok: true, skipped: "non-default branch" });
    }

    const { data: repo } = await db
      .from("repos")
      .select("id")
      .eq("github_repo_id", payload.repository?.id)
      .eq("is_active", true)
      .single();

    if (repo) {
      const { data: log } = await db
        .from("scan_logs")
        .insert({ repo_id: repo.id, triggered_by: "webhook", status: "pending" })
        .select("id")
        .single();

      if (log) {
        scanRepo(repo.id, log.id).catch(console.error);
      }
    }
  }

  if (event === "pull_request") {
    const action = payload.action;
    const prNumber = payload.pull_request?.number;
    const githubRepoId = payload.repository?.id;

    if (["opened", "reopened", "synchronize"].includes(action) && prNumber && githubRepoId) {
      const { data: repo } = await db
        .from("repos")
        .select("id, is_active")
        .eq("github_repo_id", githubRepoId)
        .single();

      if (repo?.is_active) {
        const impact = await computePrImpactForRepo({ repoId: repo.id, prNumber });
        if (impact.ok) {
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

          if (!commentResult.ok) {
            console.error("[trailmap] PR comment failed", commentResult.error);
          }
        } else {
          console.error("[trailmap] PR impact failed", impact.error);
        }
      }
    }
  }

  if (event === "installation" || event === "installation_repositories") {
    const installationId = payload.installation?.id;

    if (event === "installation_repositories") {
      const { data: org } = await db
        .from("organizations")
        .select("id")
        .eq("github_installation_id", installationId)
        .single();

      if (org) {
        for (const repo of payload.repositories_added ?? []) {
          await db.from("repos").upsert({
            org_id: org.id, github_repo_id: repo.id, name: repo.name,
            full_name: repo.full_name, private: repo.private, default_branch: "main", is_active: false,
          }, { onConflict: "org_id,github_repo_id" });
        }
        for (const repo of payload.repositories_removed ?? []) {
          await db.from("repos").update({ is_active: false })
            .eq("github_repo_id", repo.id).eq("org_id", org.id);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export const maxDuration = 300;
