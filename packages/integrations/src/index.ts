import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { zipSync, strToU8 } from "fflate";

/**
 * Evidence leaves Trailmap through an EvidenceDestination. Destinations are opt-in (see
 * `enabledDestinations`) and hold no credentials of their own: whoever constructs one passes
 * the endpoint and token. Endpoints are configuration on purpose: Trailmap does not claim an
 * official integration with any compliance platform, so URLs and field names come from the
 * documentation of the platform you use.
 */

export interface EvidenceFile {
  name: string;
  mime: string;
  content: string;
}

export interface EvidenceBundle {
  repository: string;
  framework: string;
  graphHash: string;
  snapshotId?: string;
  generatedAt: string;
  /** Plain-language summary shown by destinations that display text. */
  summary: string;
  files: EvidenceFile[];
}

export interface DeliveryResult {
  destination: string;
  ok: boolean;
  /** Identifier the destination returned, when it returned one. */
  id?: string;
  detail: string;
  attempts: number;
}

export interface EvidenceDestination {
  id: string;
  name: string;
  deliver(bundle: EvidenceBundle): Promise<DeliveryResult>;
}

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Feature flags: `TRAILMAP_INTEGRATIONS=drata,vanta,webhook`. Nothing is enabled by default. */
export function enabledDestinations(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.TRAILMAP_INTEGRATIONS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// ---- shared HTTP delivery ------------------------------------------------------------

export interface HttpOptions {
  timeoutMs?: number;
  /** Total attempts including the first. Only network errors and 5xx/429 responses are retried. */
  maxAttempts?: number;
  /** Delay before retry n (1-based). Injectable so tests do not wait. */
  backoffMs?: (attempt: number) => number;
  fetchImpl?: typeof fetch;
}

const defaults = { timeoutMs: 15_000, maxAttempts: 3, backoffMs: (n: number) => 500 * 2 ** (n - 1) };

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("***");
  return out;
}

async function sendJson(
  destination: string,
  url: string,
  init: { headers: Record<string, string>; body: string },
  secrets: string[],
  opts: HttpOptions
): Promise<DeliveryResult> {
  const f = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? defaults.maxAttempts;
  const timeout = opts.timeoutMs ?? defaults.timeoutMs;
  const backoff = opts.backoffMs ?? defaults.backoffMs;
  let last = "no attempt made";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...init.headers },
        body: init.body,
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      if (res.ok) {
        let id: string | undefined;
        try {
          const j = JSON.parse(text) as { id?: unknown };
          if (j.id !== undefined) id = String(j.id);
        } catch {
          /* response need not be JSON */
        }
        return { destination, ok: true, id, detail: `Delivered (HTTP ${res.status})`, attempts: attempt };
      }
      last = redact(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, secrets);
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable) return { destination, ok: false, detail: last, attempts: attempt };
    } catch (err) {
      last = redact(err instanceof Error ? err.message : String(err), secrets);
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, backoff(attempt)));
  }
  return { destination, ok: false, detail: `Gave up after ${maxAttempts} attempts: ${last}`, attempts: maxAttempts };
}

function payloadFor(bundle: EvidenceBundle) {
  return {
    source: "trailmap",
    repository: bundle.repository,
    framework: bundle.framework,
    graphHash: bundle.graphHash,
    snapshotId: bundle.snapshotId ?? null,
    generatedAt: bundle.generatedAt,
    summary: bundle.summary,
    files: bundle.files.map((f) => ({ name: f.name, mime: f.mime, sha256: sha256(f.content), content: f.content })),
  };
}

// ---- Drata-style: bearer token, user-configured endpoint -------------------------------

export interface BearerDestinationConfig extends HttpOptions {
  /** Full URL of the resource endpoint, taken from the platform's API documentation. */
  endpoint: string;
  token: string;
}

/** Push an evidence bundle to a custom-connection style endpoint authenticated with a bearer token (Drata). */
export function drataDestination(cfg: BearerDestinationConfig): EvidenceDestination {
  return {
    id: "drata",
    name: "Drata (custom connection)",
    deliver: (bundle) =>
      sendJson("drata", cfg.endpoint, { headers: { authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(payloadFor(bundle)) }, [cfg.token], cfg),
  };
}

// ---- Vanta-style: OAuth client credentials --------------------------------------------

export interface OAuthDestinationConfig extends HttpOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  endpoint: string;
}

/** Push an evidence bundle to a private-integration style endpoint using an OAuth client-credentials token (Vanta). */
export function vantaDestination(cfg: OAuthDestinationConfig): EvidenceDestination {
  return {
    id: "vanta",
    name: "Vanta (private integration)",
    async deliver(bundle) {
      const f = cfg.fetchImpl ?? fetch;
      const secrets = [cfg.clientSecret];
      let token: string;
      try {
        const res = await f(cfg.tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "client_credentials", ...(cfg.scope ? { scope: cfg.scope } : {}) }),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? defaults.timeoutMs),
        });
        const body = (await res.json().catch(() => ({}))) as { access_token?: string };
        if (!res.ok || !body.access_token) {
          return { destination: "vanta", ok: false, detail: `Could not get an access token (HTTP ${res.status})`, attempts: 1 };
        }
        token = body.access_token;
        secrets.push(token);
      } catch (err) {
        return { destination: "vanta", ok: false, detail: redact(`Could not get an access token: ${err instanceof Error ? err.message : String(err)}`, secrets), attempts: 1 };
      }
      return sendJson("vanta", cfg.endpoint, { headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(payloadFor(bundle)) }, secrets, cfg);
    },
  };
}

// ---- generic signed webhook ------------------------------------------------------------

export interface WebhookConfig extends HttpOptions {
  url: string;
  secret: string;
  now?: () => number;
}

/** `sha256=` HMAC over `<timestamp>.<body>`, so a captured request cannot be replayed later. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyWebhook(
  secret: string,
  body: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  { toleranceSeconds = 300, now = () => Date.now() }: { toleranceSeconds?: number; now?: () => number } = {}
): boolean {
  if (!secret || !signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now() / 1000 - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, ts, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function webhookDestination(cfg: WebhookConfig): EvidenceDestination {
  return {
    id: "webhook",
    name: "Signed webhook",
    deliver(bundle) {
      const body = JSON.stringify(payloadFor(bundle));
      const ts = Math.floor((cfg.now?.() ?? Date.now()) / 1000);
      return sendJson(
        "webhook",
        cfg.url,
        { headers: { "x-trailmap-timestamp": String(ts), "x-trailmap-signature": signWebhook(cfg.secret, ts, body) }, body },
        [cfg.secret],
        cfg
      );
    },
  };
}

// ---- downloadable pack -----------------------------------------------------------------

export interface PackResult {
  filename: string;
  bytes: Uint8Array;
  sha256: string;
}

/** Zip an evidence bundle into a single file. A manifest with per-file hashes is included. */
export function buildPack(bundle: EvidenceBundle): PackResult {
  const manifest = {
    repository: bundle.repository,
    framework: bundle.framework,
    graphHash: bundle.graphHash,
    snapshotId: bundle.snapshotId ?? null,
    generatedAt: bundle.generatedAt,
    files: Object.fromEntries(bundle.files.map((f) => [f.name, sha256(f.content)])),
  };
  const entries: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const f of bundle.files) entries[f.name] = strToU8(f.content);
  // Fixed modification times keep the archive byte-identical for the same content.
  const bytes = zipSync(entries, { mtime: new Date(Date.UTC(2020, 0, 1)) });
  return { filename: `trailmap-${bundle.framework}-${bundle.graphHash.slice(0, 12)}.zip`, bytes, sha256: sha256(bytes) };
}

export function packDestination(onPack: (pack: PackResult) => void | Promise<void>): EvidenceDestination {
  return {
    id: "pack",
    name: "Downloadable pack",
    async deliver(bundle) {
      const pack = buildPack(bundle);
      await onPack(pack);
      return { destination: "pack", ok: true, id: pack.sha256, detail: `Built ${pack.filename} (${pack.bytes.length} bytes)`, attempts: 1 };
    },
  };
}

/** Deliver to several destinations; one failing never stops the others. */
export async function deliverAll(bundle: EvidenceBundle, destinations: EvidenceDestination[]): Promise<DeliveryResult[]> {
  return Promise.all(
    destinations.map((d) =>
      d.deliver(bundle).catch((err): DeliveryResult => ({ destination: d.id, ok: false, detail: err instanceof Error ? err.message : String(err), attempts: 1 }))
    )
  );
}
