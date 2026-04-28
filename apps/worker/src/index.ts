import "dotenv/config";
import { runScanJob } from "./scan-job.js";
import { getDb } from "./db.js";

const POLL_INTERVAL_MS = 5000;
let isRunning = false;

async function pollAndProcess() {
  if (isRunning) return;
  isRunning = true;

  const db = getDb();
  try {
    // Pick up one pending scan at a time
    const { data: pending } = await db
      .from("scan_logs")
      .select("id, repo_id")
      .eq("status", "pending")
      .is("started_at", null)
      .order("created_at", { ascending: true })
      .limit(1);

    if (!pending?.length) return;

    const log = pending[0];
    console.log(`[worker] Processing scan ${log.id} for repo ${log.repo_id}`);

    await runScanJob({ scanLogId: log.id, repoId: log.repo_id });
    console.log(`[worker] Completed scan ${log.id}`);
  } catch (err) {
    console.error("[worker] Error:", err);
  } finally {
    isRunning = false;
  }
}

setInterval(pollAndProcess, POLL_INTERVAL_MS);
pollAndProcess(); // run immediately on start

console.log("[worker] Trailmap worker started — polling every 5s");
