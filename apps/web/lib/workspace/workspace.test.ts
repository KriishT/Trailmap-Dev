import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalDb, PgClient, type LocalDb } from "@trailmap/localdb";
import { demoWorkspace } from "../demo/workspace";
import { landingData } from "../demo/landing";
import { buildDemoData } from "../demo/build";
import demoJson from "../demo/demo-data.json";
import { seedLocalDb } from "../local-seed";
import { LOCAL_REPOS, LOCAL_USERS, SANDBOX_ACK, isLocalMode, localUserFromCookie } from "../local-mode";
import { notLocal } from "../local-guard";
import { errorMessage } from "../errors";
import { toClientWorkspace } from "./client-data";
import { buildInspectorIndex, sceneEdgeId } from "./inspect";
import { loadWorkspace, summarizeChange } from "./load";
import { parseSceneRequest, renderSheet } from "./scene";
import { revisionLabel } from "./types";

describe("sample workspace", () => {
  it("has six revisions, the latest selected by default", () => {
    const w = demoWorkspace();
    expect(w.revisions.map((r) => r.label)).toEqual(["Rev A", "Rev B", "Rev C", "Rev D", "Rev E", "Rev F"]);
    expect(w.selectedId).toBe("5");
    expect(w.demo).toBe(true);
    expect(w.graph.meta.graphHash).toBe(w.revisions[5]!.graphHash);
  });

  it("honours a revision number and ignores nonsense", () => {
    expect(demoWorkspace("0").selectedId).toBe("0");
    expect(demoWorkspace("0").highlightNodeIds).toEqual([]);
    expect(demoWorkspace("99").selectedId).toBe("5");
    expect(demoWorkspace("abc").selectedId).toBe("5");
    expect(demoWorkspace("2").highlightNodeIds.length + demoWorkspace("2").highlightEdgeIds.length).toBeGreaterThan(0);
  });

  it("reports the sample pull request as a scope-drift failure", () => {
    const [d] = demoWorkspace().drift;
    expect(d!.conclusion).toBe("failure");
    expect(d!.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["new_vendor", "data_class_to_vendor"]));
  });

  it("the committed demo data equals what the generator produces now", async () => {
    const fresh = await buildDemoData();
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(demoJson);
  });

  it("client data omits the graph but keeps what the browser shows", () => {
    const c = toClientWorkspace(demoWorkspace());
    expect(c).not.toHaveProperty("graph");
    expect(c).not.toHaveProperty("effective");
    expect(c.vendors.map((v) => v.name)).toContain("Stripe");
    expect(c.hasDataClasses).toBe(true);
    expect(c.hasNetworkSheet).toBe(true);
    expect(c.frameworks.map((f) => f.id)).toEqual(expect.arrayContaining(["pci-dss", "soc2", "dora"]));
    expect(c.graphHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("inspector index", () => {
  const w = demoWorkspace();
  const idx = buildInspectorIndex(w.effective, w.scopes);

  it("indexes every node and edge by the ids the sheet uses", () => {
    expect(Object.keys(idx.nodes)).toHaveLength(w.effective.nodes.length);
    for (const e of w.effective.edges) expect(idx.edges[sceneEdgeId(e)]).toBeDefined();
  });

  it("lists connections and scope membership", () => {
    const payments = idx.nodes["service:services/payments"]!;
    expect(payments.scopes).toContain("PCI cardholder data environment");
    expect(payments.outbound.length + payments.inbound.length).toBeGreaterThan(0);
  });

  it("falls back to from>to:type for edges written before ids existed", () => {
    expect(sceneEdgeId({ from: "a", to: "b", type: "http" })).toBe("a>b:http");
    expect(sceneEdgeId({ id: "e_1", from: "a", to: "b", type: "http" })).toBe("e_1");
  });
});

describe("scene requests", () => {
  it("accepts good requests and applies defaults", () => {
    expect(parseSceneRequest({})).toMatchObject({ sheet: "system", showLibraries: false });
    expect(parseSceneRequest({ sheet: "data-flow", dataClass: "PAN", minConfidence: "high" })).toMatchObject({ sheet: "data-flow", dataClass: "PAN" });
    expect(parseSceneRequest({ scopes: [{ id: "s", name: "x".repeat(200), nodeIds: ["a"] }] })!.scopes![0]!.name).toHaveLength(80);
  });

  it("rejects malformed ones", () => {
    for (const bad of [{ sheet: "nope" }, { dataClass: "SSN" }, { minConfidence: "certain" }, { scopes: "x" }, { scopes: [{ id: 1 }] }, { scopes: Array.from({ length: 21 }, () => ({ id: "a", name: "n", nodeIds: [] })) }, { scopes: [{ id: "a", name: "n", nodeIds: [1] }] }]) {
      expect(parseSceneRequest(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("draws both themes from one layout, interactive unless told otherwise", async () => {
    const w = demoWorkspace();
    const r = await renderSheet(w, { sheet: "system" });
    expect(r.nodeCount).toBeGreaterThan(5);
    expect(r.svg.light).toContain("data-node-id");
    expect(r.svg.light).not.toBe(r.svg.dark);
    const s = await renderSheet(w, { sheet: "system", interactive: false });
    expect(s.svg.light).not.toContain("data-node-id");
  });

  it("previews a draft scope instead of the saved one", async () => {
    const w = demoWorkspace();
    const saved = await renderSheet(w, { sheet: "system" });
    const draft = await renderSheet(w, { sheet: "system", scopes: [{ id: "d", name: "Draft scope", nodeIds: ["service:services/orders"] }] });
    expect(draft.svg.light).toContain("DRAFT SCOPE");
    expect(saved.svg.light).not.toContain("DRAFT SCOPE");
  });

  it("explains an empty sheet", async () => {
    const w = demoWorkspace("0");
    const r = await renderSheet(w, { sheet: "data-flow", dataClass: "PHI" });
    expect(r.empty ?? "").toMatch(/data class/i);
  });
});

describe("landing page data", () => {
  it("comes from the same sample data as the product", async () => {
    const d = await landingData();
    expect(d.vendorsOutput).toContain("Stripe");
    expect(d.vendorsOutput.split("\n")[0]).toContain("Vendor");
    expect(d.revisions).toHaveLength(6);
    expect(d.drift.conclusion).toBe("failure");
    expect(d.sheet.svg.light).not.toContain("data-node-id");
    expect(await landingData()).toBe(d);
  });
});

describe("revision labels and change summaries", () => {
  it("count A..Z then AA", () => {
    expect([0, 1, 25, 26, 27].map(revisionLabel)).toEqual(["Rev A", "Rev B", "Rev Z", "Rev AA", "Rev AB"]);
  });
  it("summarises changes in plain words", () => {
    const w = demoWorkspace();
    expect(w.revisions[0]!.summary).toBe("Initial snapshot");
    expect(w.revisions.some((r) => /node|connection|exposure/.test(r.summary))).toBe(true);
    expect(summarizeChange(w.graph, w.graph)).toBe("No architectural change");
  });
});

describe("local mode guard", () => {
  const set = (env: Record<string, string | undefined>) => {
    const saved = { ...process.env };
    for (const [k, v] of Object.entries(env)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    return () => {
      for (const k of Object.keys(env)) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
    };
  };

  it("is off unless asked for", () => {
    const undo = set({ TRAILMAP_LOCAL: undefined });
    expect(isLocalMode()).toBe(false);
    undo();
  });

  it("refuses to run in production without the sandbox acknowledgement", () => {
    const undo = set({ TRAILMAP_LOCAL: "1", NODE_ENV: "production", TRAILMAP_LOCAL_SANDBOX: undefined });
    expect(() => isLocalMode()).toThrow(/not allowed in production/);
    undo();
  });

  it("runs in production only with the acknowledgement, and in development freely", () => {
    let undo = set({ TRAILMAP_LOCAL: "1", NODE_ENV: "production", TRAILMAP_LOCAL_SANDBOX: SANDBOX_ACK });
    expect(isLocalMode()).toBe(true);
    undo();
    undo = set({ TRAILMAP_LOCAL: "1", NODE_ENV: "development", TRAILMAP_LOCAL_SANDBOX: undefined });
    expect(isLocalMode()).toBe(true);
    undo();
  });

  it("local-only routes answer 404 outside local mode, including a misconfigured production", async () => {
    let undo = set({ TRAILMAP_LOCAL: undefined });
    expect((await notLocal())!.status).toBe(404);
    undo();
    undo = set({ TRAILMAP_LOCAL: "1", NODE_ENV: "production", TRAILMAP_LOCAL_SANDBOX: undefined });
    expect(notLocal()!.status).toBe(404);
    undo();
    undo = set({ TRAILMAP_LOCAL: "1", NODE_ENV: "development" });
    expect(notLocal()).toBeNull();
    undo();
  });

  it("cookie lookup only accepts known sample users", () => {
    expect(localUserFromCookie(LOCAL_USERS.kay!.id)).toBe(LOCAL_USERS.kay!.id);
    expect(localUserFromCookie("nobody")).toBeFalsy();
    expect(localUserFromCookie(undefined)).toBeFalsy();
  });
});

describe("errorMessage", () => {
  it("prefers real messages", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("Something went wrong");
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback");
  });
});

describe("loadWorkspace against the seeded database", () => {
  let db: LocalDb;
  const as = (id: string | null) => new PgClient(db, id ? "authenticated" : "anon", id) as never;

  beforeAll(async () => {
    db = await createLocalDb();
    await seedLocalDb(db);
  });
  afterAll(async () => {
    await db.pg.close();
  });

  it("an owner gets revisions, scopes, drift and admin rights", async () => {
    const w = (await loadWorkspace(as(LOCAL_USERS.kay!.id), LOCAL_REPOS.shop))!;
    expect(w.repo.fullName).toBe("acme/shop");
    expect(w.revisions.length).toBeGreaterThanOrEqual(5);
    expect(w.permissions.canAdmin).toBe(true);
    expect(w.scopes.length).toBeGreaterThan(0);
    expect(w.exports.length).toBeGreaterThan(0);
    expect(w.revisions.every((r) => typeof r.scannedAt === "string")).toBe(true);
  });

  it("a plain member can read but is not an admin", async () => {
    const w = (await loadWorkspace(as(LOCAL_USERS.lee!.id), LOCAL_REPOS.shop))!;
    expect(w.permissions.canAdmin).toBe(false);
  });

  it("time travel picks the snapshot in force on a date", async () => {
    const all = (await loadWorkspace(as(LOCAL_USERS.kay!.id), LOCAL_REPOS.shop))!;
    const second = all.revisions[1]!;
    const day = second.scannedAt.slice(0, 10);
    expect((await loadWorkspace(as(LOCAL_USERS.kay!.id), LOCAL_REPOS.shop, { asOf: day }))!.selectedId).toBe(second.id);
    expect((await loadWorkspace(as(LOCAL_USERS.kay!.id), LOCAL_REPOS.shop, { asOf: "1999-01-01" }))!.selectedId).toBe(all.revisions[0]!.id);
    expect((await loadWorkspace(as(LOCAL_USERS.kay!.id), LOCAL_REPOS.shop, { rev: all.revisions[2]!.id }))!.selectedId).toBe(all.revisions[2]!.id);
    expect((await loadWorkspace(as(LOCAL_USERS.kay!.id), LOCAL_REPOS.shop, { rev: "unknown" }))!.selectedId).toBe(all.revisions.at(-1)!.id);
  });

  it("another organisation, or nobody, sees nothing", async () => {
    expect(await loadWorkspace(as(LOCAL_USERS.mia!.id), LOCAL_REPOS.shop)).toBeNull();
    expect(await loadWorkspace(as(null), LOCAL_REPOS.shop)).toBeNull();
  });
});
