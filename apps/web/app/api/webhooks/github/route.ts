import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { checkGithubSignature } from "@/lib/webhook-signature";
import { handleGithubEvent } from "@/lib/github-events";
import { githubApi } from "@/lib/github-api";

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

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await handleGithubEvent(req.headers.get("x-github-event"), payload, {
    db: supabaseAdmin(),
    github: githubApi,
  });
  return NextResponse.json({ ok: true, ...result });
}

export const maxDuration = 60;
