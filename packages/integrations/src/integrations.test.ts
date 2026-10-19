import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { unzipSync, strFromU8 } from "fflate";
import {
  buildPack, deliverAll, drataDestination, enabledDestinations, packDestination, sha256, signWebhook, vantaDestination,
  verifyWebhook, webhookDestination, type EvidenceBundle,
} from "./index";

const bundle: EvidenceBundle = {
  repository: "acme/shop",
  framework: "pci-dss",
  graphHash: "a".repeat(64),
  snapshotId: "snap-1",
  generatedAt: "2026-01-01T00:00:00.000Z",
  summary: "2 vendors, 1 data flow with PAN",
  files: [
    { name: "vendors.csv", mime: "text/csv", content: "Vendor\r\nStripe\r\n" },
    { name: "graph.json", mime: "application/json", content: '{"nodes":[]}' },
  ],
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const fast = { backoffMs: () => 0 };

describe("feature flags", () => {
  it("enables nothing by default and parses a comma list", () => {
    expect(enabledDestinations({}).size).toBe(0);
    expect([...enabledDestinations({ TRAILMAP_INTEGRATIONS: " Drata, webhook ,," })].sort()).toEqual(["drata", "webhook"]);
  });
});

describe("bearer-token destination (Drata-style)", () => {
  it("posts the bundle with hashes and a bearer token, and reports the returned id", async () => {
    let seen: { auth: string | null; body: Record<string, unknown> } | null = null;
    server.use(http.post("https://api.drata.test/custom/resources", async ({ request }) => {
      seen = { auth: request.headers.get("authorization"), body: (await request.json()) as Record<string, unknown> };
      return HttpResponse.json({ id: 42 }, { status: 201 });
    }));
    const r = await drataDestination({ endpoint: "https://api.drata.test/custom/resources", token: "dr_secret", ...fast }).deliver(bundle);
    expect(r).toMatchObject({ destination: "drata", ok: true, id: "42", attempts: 1 });
    expect(seen!.auth).toBe("Bearer dr_secret");
    expect(seen!.body).toMatchObject({ source: "trailmap", repository: "acme/shop", framework: "pci-dss", graphHash: bundle.graphHash });
    const files = seen!.body.files as Array<{ name: string; sha256: string; content: string }>;
    expect(files[0]).toMatchObject({ name: "vendors.csv", sha256: sha256("Vendor\r\nStripe\r\n") });
  });

  it("does not retry a client error, and never echoes the token", async () => {
    let calls = 0;
    server.use(http.post("https://api.drata.test/x", () => { calls++; return new HttpResponse("bad token dr_secret", { status: 401 }); }));
    const r = await drataDestination({ endpoint: "https://api.drata.test/x", token: "dr_secret", ...fast }).deliver(bundle);
    expect(r.ok).toBe(false);
    expect(calls).toBe(1);
    expect(r.detail).toContain("HTTP 401");
    expect(r.detail).not.toContain("dr_secret");
  });

  it("retries server errors and succeeds when the service recovers", async () => {
    let calls = 0;
    server.use(http.post("https://api.drata.test/x", () => (++calls < 3 ? new HttpResponse("down", { status: 503 }) : HttpResponse.json({ id: "ok" }))));
    const r = await drataDestination({ endpoint: "https://api.drata.test/x", token: "t", ...fast }).deliver(bundle);
    expect(r).toMatchObject({ ok: true, attempts: 3, id: "ok" });
  });

  it("gives up after the attempt limit, with a clear message", async () => {
    server.use(http.post("https://api.drata.test/x", () => new HttpResponse("down", { status: 500 })));
    const r = await drataDestination({ endpoint: "https://api.drata.test/x", token: "t", maxAttempts: 2, ...fast }).deliver(bundle);
    expect(r).toMatchObject({ ok: false, attempts: 2 });
    expect(r.detail).toMatch(/Gave up after 2 attempts/);
  });

  it("retries network failures", async () => {
    let calls = 0;
    server.use(http.post("https://api.drata.test/x", () => (++calls === 1 ? HttpResponse.error() : HttpResponse.json({ id: 1 }))));
    expect(await drataDestination({ endpoint: "https://api.drata.test/x", token: "t", ...fast }).deliver(bundle)).toMatchObject({ ok: true, attempts: 2 });
  });
});

describe("OAuth destination (Vanta-style)", () => {
  const cfg = { tokenUrl: "https://api.vanta.test/oauth/token", clientId: "cid", clientSecret: "csecret", endpoint: "https://api.vanta.test/v1/resources", ...fast };

  it("exchanges client credentials for a token and uses it", async () => {
    let tokenBody: Record<string, string> | null = null;
    let auth: string | null = null;
    server.use(
      http.post(cfg.tokenUrl, async ({ request }) => { tokenBody = (await request.json()) as Record<string, string>; return HttpResponse.json({ access_token: "tok123" }); }),
      http.post(cfg.endpoint, ({ request }) => { auth = request.headers.get("authorization"); return HttpResponse.json({ id: "r1" }); })
    );
    const r = await vantaDestination({ ...cfg, scope: "vanta-api.all:write" }).deliver(bundle);
    expect(r).toMatchObject({ destination: "vanta", ok: true, id: "r1" });
    expect(tokenBody).toMatchObject({ client_id: "cid", client_secret: "csecret", grant_type: "client_credentials", scope: "vanta-api.all:write" });
    expect(auth).toBe("Bearer tok123");
  });

  it("reports a failed token exchange without delivering anything", async () => {
    let delivered = false;
    server.use(
      http.post(cfg.tokenUrl, () => new HttpResponse(JSON.stringify({ error: "invalid_client" }), { status: 401 })),
      http.post(cfg.endpoint, () => { delivered = true; return HttpResponse.json({}); })
    );
    const r = await vantaDestination(cfg).deliver(bundle);
    expect(r).toMatchObject({ ok: false });
    expect(r.detail).toContain("Could not get an access token (HTTP 401)");
    expect(delivered).toBe(false);
  });

  it("does not leak the secret or token when the network fails", async () => {
    server.use(http.post(cfg.tokenUrl, () => HttpResponse.error()));
    const r = await vantaDestination(cfg).deliver(bundle);
    expect(r.ok).toBe(false);
    expect(r.detail).not.toContain("csecret");
  });
});

describe("signed webhook", () => {
  const secret = "whsec_test";

  it("signs timestamp and body so the receiver can verify and reject replays", async () => {
    let req: { sig: string | null; ts: string | null; body: string } | null = null;
    server.use(http.post("https://hooks.test/in", async ({ request }) => {
      req = { sig: request.headers.get("x-trailmap-signature"), ts: request.headers.get("x-trailmap-timestamp"), body: await request.text() };
      return new HttpResponse(null, { status: 204 });
    }));
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const r = await webhookDestination({ url: "https://hooks.test/in", secret, now: () => now, ...fast }).deliver(bundle);
    expect(r.ok).toBe(true);
    expect(verifyWebhook(secret, req!.body, req!.sig, req!.ts, { now: () => now })).toBe(true);
    expect(verifyWebhook(secret, req!.body + " ", req!.sig, req!.ts, { now: () => now })).toBe(false);
    expect(verifyWebhook("other", req!.body, req!.sig, req!.ts, { now: () => now })).toBe(false);
    expect(verifyWebhook(secret, req!.body, req!.sig, req!.ts, { now: () => now + 10 * 60 * 1000 })).toBe(false);
  });

  it("rejects missing or malformed signature inputs", () => {
    expect(verifyWebhook("", "b", "sha256=x", "1")).toBe(false);
    expect(verifyWebhook(secret, "b", null, "1")).toBe(false);
    expect(verifyWebhook(secret, "b", "sha256=x", "not-a-number")).toBe(false);
    expect(signWebhook(secret, 1, "b")).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe("downloadable pack", () => {
  it("zips the files with a manifest of hashes, deterministically", () => {
    const a = buildPack(bundle);
    const b = buildPack(bundle);
    expect(a.sha256).toBe(b.sha256);
    expect(a.filename).toBe(`trailmap-pci-dss-${"a".repeat(12)}.zip`);
    const files = unzipSync(a.bytes);
    expect(Object.keys(files).sort()).toEqual(["graph.json", "manifest.json", "vendors.csv"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest.files["vendors.csv"]).toBe(sha256("Vendor\r\nStripe\r\n"));
    expect(strFromU8(files["vendors.csv"]!)).toBe("Vendor\r\nStripe\r\n");
  });

  it("hands the pack to the caller", async () => {
    let got = "";
    const r = await packDestination((p) => { got = p.filename; }).deliver(bundle);
    expect(r).toMatchObject({ destination: "pack", ok: true, attempts: 1 });
    expect(got).toContain("trailmap-pci-dss");
  });
});

describe("deliverAll", () => {
  it("keeps going when one destination fails or throws", async () => {
    server.use(http.post("https://hooks.test/ok", () => new HttpResponse(null, { status: 200 })));
    const results = await deliverAll(bundle, [
      { id: "boom", name: "boom", deliver: async () => { throw new Error("kaput"); } },
      webhookDestination({ url: "https://hooks.test/ok", secret: "s", ...fast }),
    ]);
    expect(results.map((r) => [r.destination, r.ok])).toEqual([["boom", false], ["webhook", true]]);
    expect(results[0]!.detail).toBe("kaput");
  });
});
