import { NextResponse } from "next/server";
import { requireRepoAccess } from "@/lib/authz";

const str = (v: unknown, max = 300) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const EDGE_TYPES = new Set(["http", "import", "queue", "database", "storage", "network"]);
const CLASSES = new Set(["PII", "PAN", "PHI", "CREDENTIALS"]);

/** Validate a decision and reduce it to the payload we store. Returns null when it is malformed. */
export function parseOverride(body: Record<string, unknown>): { kind: string; payload: Record<string, unknown> } | null {
  switch (body.kind) {
    case "confirm_edge":
    case "hide_edge": {
      const edgeId = str(body.edgeId);
      return edgeId ? { kind: body.kind, payload: { edgeId } } : null;
    }
    case "hide_node": {
      const nodeId = str(body.nodeId);
      return nodeId ? { kind: "hide_node", payload: { nodeId } } : null;
    }
    case "add_edge": {
      const from = str(body.from), to = str(body.to), edgeType = str(body.edgeType, 20);
      return from && to && edgeType && EDGE_TYPES.has(edgeType) ? { kind: "add_edge", payload: { from, to, edgeType } } : null;
    }
    case "set_data_class": {
      const t = body.target as { kind?: unknown; id?: unknown } | undefined;
      const id = str(t?.id);
      const cls = str(body.class, 20);
      return id && (t?.kind === "edge" || t?.kind === "node") && cls && CLASSES.has(cls) && typeof body.present === "boolean"
        ? { kind: "set_data_class", payload: { target: { kind: t.kind, id }, class: cls, present: body.present } }
        : null;
    }
    default:
      return null;
  }
}

/** Record a human decision about the graph. It needs a reason, and it applies to every later snapshot. */
export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const access = await requireRepoAccess(repoId);
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const parsed = parseOverride(body);
  if (!parsed) return NextResponse.json({ error: "Unknown or incomplete decision" }, { status: 400 });
  if (!reason || reason.length > 500) return NextResponse.json({ error: "A reason of up to 500 characters is required" }, { status: 400 });

  const { data, error } = await access.supabase
    .from("graph_overrides")
    .insert({ repo_id: repoId, kind: parsed.kind, payload: parsed.payload, reason, actor_id: access.user.id })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "Only organisation owners and admins can record decisions" }, { status: 403 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
