import type { SupabaseClient } from "@supabase/supabase-js";
import { mergePolicy, parsePolicy, type Override, type Policy, type Scope, defaultPolicy } from "@trailmap/graph";

/** Everything people have decided about a repo that is layered on top of scanner output. */
export interface ComplianceContext {
  scopes: Scope[];
  overrides: Override[];
  /** Policy set in the app. Merged over `.trailmap.yml`. */
  appPolicy: Partial<Policy> | null;
}

interface OverrideRow {
  id: string;
  kind: Override["kind"];
  payload: Record<string, unknown>;
  reason: string;
  actor_id: string;
  created_at: string;
}

/** Turn a stored row into the shape `applyOverrides` expects. Returns null for rows it cannot interpret. */
export function overrideFromRow(row: OverrideRow, actorLabel: string): Override | null {
  const base = { id: row.id, reason: row.reason, actor: actorLabel, createdAt: row.created_at };
  const p = row.payload;
  switch (row.kind) {
    case "confirm_edge":
    case "hide_edge":
      return typeof p.edgeId === "string" ? { ...base, kind: row.kind, edgeId: p.edgeId } : null;
    case "hide_node":
      return typeof p.nodeId === "string" ? { ...base, kind: "hide_node", nodeId: p.nodeId } : null;
    case "add_edge":
      return typeof p.from === "string" && typeof p.to === "string" && typeof p.edgeType === "string"
        ? { ...base, kind: "add_edge", from: p.from, to: p.to, edgeType: p.edgeType as never }
        : null;
    case "set_data_class": {
      const t = p.target as { kind?: string; id?: string } | undefined;
      return t?.id && (t.kind === "edge" || t.kind === "node") && typeof p.class === "string" && typeof p.present === "boolean"
        ? { ...base, kind: "set_data_class", target: { kind: t.kind, id: t.id }, class: p.class as never, present: p.present }
        : null;
    }
    default:
      return null;
  }
}

/** Load scopes, active overrides and the app-level policy for a repo. Pass a client that may read them. */
export async function loadComplianceContext(db: SupabaseClient, repoId: string): Promise<ComplianceContext> {
  const { data: scopeRows } = await db.from("scopes").select("id, name").eq("repo_id", repoId);
  const scopes: Scope[] = [];
  if (scopeRows?.length) {
    const { data: members } = await db
      .from("scope_members")
      .select("scope_id, node_id")
      .in("scope_id", scopeRows.map((s) => s.id));
    for (const s of scopeRows) {
      scopes.push({
        id: s.id as string,
        name: s.name as string,
        nodeIds: (members ?? []).filter((m) => m.scope_id === s.id).map((m) => m.node_id as string).sort(),
      });
    }
    scopes.sort((a, b) => a.name.localeCompare(b.name));
  }

  const { data: overrideRows } = await db
    .from("graph_overrides")
    .select("id, kind, payload, reason, actor_id, created_at")
    .eq("repo_id", repoId)
    .is("revoked_at", null);
  const overrides: Override[] = [];
  if (overrideRows?.length) {
    const actorIds = [...new Set(overrideRows.map((r) => r.actor_id as string))];
    const { data: users } = await db.from("users").select("id, email").in("id", actorIds);
    const label = new Map((users ?? []).map((u) => [u.id as string, (u.email as string) ?? (u.id as string)]));
    for (const row of overrideRows as OverrideRow[]) {
      const o = overrideFromRow(row, label.get(row.actor_id) ?? row.actor_id);
      if (o) overrides.push(o);
    }
  }

  const { data: policyRow } = await db.from("repo_policies").select("config").eq("repo_id", repoId).maybeSingle();
  const appPolicy = (policyRow?.config as Partial<Policy> | undefined) ?? null;

  return { scopes, overrides, appPolicy };
}

/** Combine the repository's `.trailmap.yml` with settings made in the app. */
export function resolvePolicy(fileText: string | null, appPolicy: Partial<Policy> | null): { policy: Policy; errors: string[] } {
  const parsed = parsePolicy(fileText);
  return { policy: mergePolicy(parsed.policy ?? defaultPolicy(), appPolicy), errors: parsed.errors };
}

/** Scopes defined in `.trailmap.yml` become scopes with a stable synthetic id. */
export function scopesFromPolicy(policy: Policy): Scope[] {
  return policy.scopes.map((s) => ({ id: `policy:${s.name}`, name: s.name, nodeIds: [...s.nodes].sort() }));
}
