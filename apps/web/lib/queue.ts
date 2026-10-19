import type { SupabaseClient } from "@supabase/supabase-js";

export type ScanTrigger = "manual" | "webhook" | "scheduled" | "install";

export interface EnqueueResult {
  scanLogId: string;
  /** True when an unfinished scan for this repo already existed and was reused. */
  alreadyQueued: boolean;
}

/**
 * Queue a scan. Routes only ever enqueue; the worker is the sole executor
 * (it claims rows with claim_scan_job()). Pass a service-role client.
 */
export async function enqueueScan(
  db: SupabaseClient,
  repoId: string,
  triggeredBy: ScanTrigger
): Promise<EnqueueResult> {
  const { data: existing } = await db
    .from("scan_logs")
    .select("id")
    .eq("repo_id", repoId)
    .eq("kind", "scan")
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { scanLogId: existing.id, alreadyQueued: true };

  const { data: log, error } = await db
    .from("scan_logs")
    .insert({ repo_id: repoId, triggered_by: triggeredBy, status: "pending" })
    .select("id")
    .single();
  if (error || !log) throw new Error(`Failed to enqueue scan: ${error?.message ?? "no row"}`);
  return { scanLogId: log.id, alreadyQueued: false };
}

/**
 * Queue a PR scope-drift check. One pending check per PR is enough: a newer push replaces the
 * pending one, and the worker reads the PR's current head when it runs.
 */
export async function enqueuePrCheck(
  db: SupabaseClient,
  repoId: string,
  prNumber: number,
  triggeredBy: ScanTrigger = "webhook"
): Promise<EnqueueResult> {
  const { data: existing } = await db
    .from("scan_logs")
    .select("id")
    .eq("repo_id", repoId)
    .eq("kind", "pr_check")
    .eq("status", "pending")
    .contains("payload", { prNumber })
    .limit(1)
    .maybeSingle();
  if (existing) return { scanLogId: existing.id, alreadyQueued: true };

  const { data: log, error } = await db
    .from("scan_logs")
    .insert({ repo_id: repoId, triggered_by: triggeredBy, status: "pending", kind: "pr_check", payload: { prNumber } })
    .select("id")
    .single();
  if (error || !log) throw new Error(`Failed to enqueue PR check: ${error?.message ?? "no row"}`);
  return { scanLogId: log.id, alreadyQueued: false };
}

/** Queue a re-check of a drift event after someone acknowledged it. No clone or scan is involved. */
export async function enqueuePrRecheck(db: SupabaseClient, repoId: string, driftEventId: string): Promise<EnqueueResult> {
  const { data: log, error } = await db
    .from("scan_logs")
    .insert({ repo_id: repoId, triggered_by: "webhook", status: "pending", kind: "pr_recheck", payload: { driftEventId } })
    .select("id")
    .single();
  if (error || !log) throw new Error(`Failed to enqueue PR re-check: ${error?.message ?? "no row"}`);
  return { scanLogId: log.id, alreadyQueued: false };
}
