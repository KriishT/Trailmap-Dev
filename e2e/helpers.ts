import { createHmac } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { APIRequestContext, Page } from "@playwright/test";

export const KAY = "kay";
export const SHOP_REPO = "00000000-0000-4000-8000-000000a00001";
export const WEBHOOK_SECRET = "e2e-secret";

/** Text drawn with standard fonts is stored as hex strings in Flate-compressed content streams. */
export function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(t[1]!, "hex").toString("latin1") + "\n";
  }
  return out;
}

export async function signIn(page: Page | { request: APIRequestContext }, user: string = KAY) {
  const res = await page.request.post("/api/local/session", { data: { user } });
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()}`);
}

export interface CheckRun {
  name?: string;
  conclusion?: string | null;
  status?: string;
  title?: string;
  summary?: string;
}

export async function githubState(request: APIRequestContext): Promise<{ checkRuns: CheckRun[]; comments: Array<{ body: string }> }> {
  return (await request.get("/api/local/github")).json();
}

export async function runWorker(request: APIRequestContext) {
  const res = await request.post("/api/local/run-worker");
  if (!res.ok()) throw new Error(`worker failed: ${res.status()}`);
  return res.json();
}

/** Send a signed GitHub webhook the way GitHub would. */
export async function sendWebhook(request: APIRequestContext, event: string, payload: unknown, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return request.post("/api/webhooks/github", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      "x-hub-signature-256": signature,
    },
  });
}

export const prOpened = () => ({
  action: "opened",
  number: 12,
  pull_request: { number: 12, title: "Add analytics", draft: false, head: { sha: "9c1d2e3f4a5b", ref: "analytics" }, base: { ref: "main" } },
  repository: { id: 1001, full_name: "acme/shop", name: "shop", private: true, default_branch: "main" },
  installation: { id: 4242 },
});
