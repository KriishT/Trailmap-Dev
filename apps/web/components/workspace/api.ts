import type { ClientWorkspace } from "@/lib/workspace/client-data";

export interface Ctx {
  data: ClientWorkspace;
  /** `/api/repos/<id>` for a real repository, null for the sample workspace. */
  base: string | null;
  /** Ask the server for fresh data (after a change was saved). */
  refresh: () => void;
  notify: (message: string, tone?: "ok" | "bad") => void;
  /** Open a revision (snapshot id, or the sample's revision number). */
  openRevision: (id: string) => void;
}

/** Make a JSON call. Resolves to an error message, or null on success; the parsed body is returned for callers that need it. */
export async function call(method: string, url: string, body?: unknown): Promise<{ error: string | null; body: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: typeof parsed.error === "string" ? parsed.error : `Request failed (${res.status})`, body: parsed };
    return { error: null, body: parsed };
  } catch {
    return { error: "The server could not be reached. Check your connection and try again.", body: {} };
  }
}

export const DEMO_NOTE = "This is sample data, so changes are not saved. Sign in and connect a repository to keep them.";

export const fmtDate = (iso: string) => iso.slice(0, 10);
export const fmtDateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
