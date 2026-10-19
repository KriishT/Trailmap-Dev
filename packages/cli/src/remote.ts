import type { DependencyGraph } from "@trailmap/graph";

export interface RemoteOptions {
  apiUrl: string;
  apiKey: string;
  repoId: string;
}

async function post(opts: RemoteOptions, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = `${opts.apiUrl.replace(/\/$/, "")}/api/ingest/${encodeURIComponent(opts.repoId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Trailmap API ${res.status}: ${String(json.error ?? res.statusText)}`);
  return { status: res.status, json };
}

/** CI-only mode: send the graph, never the code. */
export async function uploadSnapshot(opts: RemoteOptions & { graph: DependencyGraph; commitSha?: string; branch?: string }) {
  const { json } = await post(opts, { graph: opts.graph, commitSha: opts.commitSha, branch: opts.branch });
  return json as { snapshotId: string; graphHash: string };
}

export interface RemoteVerdict {
  conclusion: "success" | "neutral" | "failure";
  summary: string;
  findings: Array<{ key: string; rule: string; severity: string; title: string; detail: string; evidence: Array<{ source: string; line?: number }> }>;
  ignored: number;
  policyErrors: string[];
}

/** Ask Trailmap to compare a pull request's graph with the stored baseline. */
export async function remoteCheck(
  opts: RemoteOptions & { graph: DependencyGraph; prNumber: number; headSha: string; policy?: string | null }
): Promise<RemoteVerdict> {
  const { json } = await post(opts, { graph: opts.graph, pr: { number: opts.prNumber, headSha: opts.headSha }, policy: opts.policy ?? undefined });
  return json as unknown as RemoteVerdict;
}
