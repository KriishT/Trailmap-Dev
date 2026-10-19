import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditInput {
  orgId?: string | null;
  repoId?: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "api_key" | "github";
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit event for something done through the API that the database cannot see on its
 * own (a key being used, an export being downloaded). Row changes on compliance tables are
 * audited by database triggers. Pass a service-role client.
 */
export async function recordAudit(admin: SupabaseClient, e: AuditInput): Promise<void> {
  const { error } = await admin.from("audit_events").insert({
    org_id: e.orgId ?? null,
    repo_id: e.repoId ?? null,
    actor_user_id: e.actorUserId ?? null,
    actor_type: e.actorType ?? "user",
    action: e.action,
    target_type: e.targetType,
    target_id: e.targetId ?? null,
    metadata: e.metadata ?? {},
  });
  if (error) console.error("[trailmap] audit write failed:", error.message);
}
