import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { scanRepo } from "@/lib/scan";

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

  // Push to default branch — scan immediately
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
      .single();

    if (repo) {
      const { data: log } = await db
        .from("scan_logs")
        .insert({ repo_id: repo.id, triggered_by: "webhook", status: "pending" })
        .select("id")
        .single();

      if (log) {
        // Fire and forget — don't await so webhook returns fast
        scanRepo(repo.id, log.id).catch(console.error);
      }
    }
  }

  // Installation events — sync repos
  if (event === "installation" || event === "installation_repositories") {
    const installationId = payload.installation?.id;
    const orgLogin = payload.installation?.account?.login;
    const orgId = payload.installation?.account?.id;

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
            full_name: repo.full_name, private: repo.private, default_branch: "main",
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

export const maxDuration = 300; // 5 min timeout on Vercel Pro
