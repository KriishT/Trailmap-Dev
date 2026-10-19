import "dotenv/config";
import { scan } from "@trailmap/scanner";
import {
  defaultCloner,
  defaultTempDir,
  processNextJob,
  type PipelineDeps,
} from "@trailmap/pipeline";
import { getDb } from "./db.js";
import { githubPort } from "./github-client.js";

const POLL_INTERVAL_MS = 5000;
let busy = false;

function buildDeps(): PipelineDeps {
  return {
    db: getDb(),
    github: githubPort,
    cloner: defaultCloner,
    tempDir: defaultTempDir,
    scan,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  };
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    // Drain the queue: keep going while there is work, then wait for the next poll.
    for (;;) {
      const outcome = await processNextJob(buildDeps());
      if (outcome.status === "idle") break;
      if (outcome.status === "completed") {
        const what = "snapshotId" in outcome ? `snapshot ${outcome.snapshotId}` : `check ${outcome.conclusion}`;
        console.log(`[worker] job ${outcome.scanLogId} completed (${what})`);
      } else {
        console.error(`[worker] job ${outcome.scanLogId} failed: ${outcome.error}`);
      }
    }
  } catch (err) {
    console.error("[worker] error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

setInterval(tick, POLL_INTERVAL_MS);
void tick();

console.log(`[worker] Trailmap worker started, polling every ${POLL_INTERVAL_MS / 1000}s`);
