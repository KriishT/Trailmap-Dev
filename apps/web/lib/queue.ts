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
