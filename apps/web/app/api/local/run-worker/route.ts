import { NextResponse } from "next/server";
import { scan } from "@trailmap/scanner";
import { defaultTempDir, processNextJob, type JobOutcome } from "@trailmap/pipeline";
import { notLocal } from "@/lib/local-guard";
import { localAdminClient } from "@/lib/local-db";
import { localCloner, localGithubPort } from "@/lib/local-github";

/** Local mode has no separate worker process: this runs the real worker pipeline on demand until the queue is empty. */
export async function POST() {
  const blocked = notLocal();
  if (blocked) return blocked;

  const outcomes: JobOutcome[] = [];
  for (let i = 0; i < 20; i++) {
    const outcome = await processNextJob({
      db: localAdminClient(),
      github: localGithubPort,
      cloner: localCloner,
      tempDir: defaultTempDir,
      scan,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    });
    if (outcome.status === "idle") break;
    outcomes.push(outcome);
  }
  return NextResponse.json({ ran: outcomes.length, outcomes });
}
