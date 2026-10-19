import { describe, expect, it } from "vitest";
import type { DependencyGraph, GraphEdge, GraphNode } from "./schema";
import { diffGraphs, edgeKey } from "./diff";
import { analyzeScope, dataFlows, suggestScope } from "./scope";
import { defaultPolicy, mergePolicy, parsePolicy, ruleEnabled } from "./policy";
import { driftFingerprint, evaluateDrift, summarize } from "./drift";
import { applyOverrides, type Override } from "./overrides";
import { buildVendorInventory, doraRegisterAssistCsv, toCsv, vendorInventoryCsv } from "./vendors";
import { analyzeChangedFiles, dependentsOf, nodeRisk } from "./impact";
import { matchOwnersForPath, parseCodeowners } from "./codeowners";

const node = (id: string, type: GraphNode["type"] = "service", extra: Partial<GraphNode> = {}): GraphNode => ({
  id, name: id.split(":").pop()!, type, language: "unknown", port: null, endpoints: [], path: id.startsWith("service:") ? id.slice(8) : "", ...extra,
});
const edge = (from: string, to: string, type: GraphEdge["type"] = "http", extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id: `${from}>${to}:${type}`, from, to, type, confidence: "high", ...extra,
});
const graph = (nodes: GraphNode[], edges: GraphEdge[] = []): DependencyGraph => ({
  meta: { repo: "r", scanned_at: "t", language_breakdown: {}, total_files: 1 },
  nodes, edges,
});
const pci = { id: "s1", name: "PCI CDE", nodeIds: ["service:pay", "db:postgres"] };

const A = node("service:pay", "service", { path: "services/pay" });
const B = node("service:web", "service", { path: "services/web" });
const DB = node("db:postgres", "database", { engine: "postgres" });
const STRIPE = node("vendor:stripe", "saas", { vendor: "stripe", name: "Stripe" });

describe("diffGraphs", () => {
  it("finds added, removed and changed nodes and edges", () => {
    const base = graph([A, B, DB], [edge(A.id, DB.id, "database"), edge(B.id, A.id)]);
    const head = graph([A, { ...B, port: 3000 }, STRIPE], [edge(A.id, STRIPE.id), edge(B.id, A.id, "http", { confidence: "low" })]);
    const d = diffGraphs(base, head);
    expect(d.addedNodes.map((n) => n.id)).toEqual(["vendor:stripe"]);
    expect(d.removedNodes.map((n) => n.id)).toEqual(["db:postgres"]);
    expect(d.changedNodes.map((c) => [c.id, c.fields])).toEqual([["service:web", ["port"]]]);
    expect(d.addedEdges.map(edgeKey)).toEqual(["service:pay>vendor:stripe:http"]);
    expect(d.removedEdges.map(edgeKey)).toEqual(["service:pay>db:postgres:database"]);
    expect(d.changedEdges[0]).toMatchObject({ before: "high", after: "low" });
    expect(d.isEmpty).toBe(false);
  });

  it("reports data classes gained and lost, including on brand new edges", () => {
    const tag = (c: "PAN" | "PII", certainty: "evidenced" | "possible" = "evidenced") => ({ class: c, certainty, evidence: [] });
    const base = graph([A, STRIPE], [edge(A.id, STRIPE.id, "http", { dataClasses: [tag("PII")] })]);
    const head = graph([A, STRIPE, DB], [
      edge(A.id, STRIPE.id, "http", { dataClasses: [tag("PAN")] }),
      edge(A.id, DB.id, "database", { dataClasses: [tag("PII")] }),
    ]);
    const d = diffGraphs(base, head);
    expect(d.addedDataClasses.map((c) => `${c.subject}:${c.class}`).sort()).toEqual([
      "service:pay>db:postgres:database:PII", "service:pay>vendor:stripe:http:PAN",
    ]);
    expect(d.removedDataClasses.map((c) => c.class)).toEqual(["PII"]);
  });

  it("is empty for identical graphs", () => {
    const g = graph([A, DB], [edge(A.id, DB.id, "database")]);
    expect(diffGraphs(g, JSON.parse(JSON.stringify(g))).isEmpty).toBe(true);
  });
});

describe("scopes", () => {
  const g = graph([A, B, DB, STRIPE], [edge(B.id, A.id), edge(A.id, DB.id, "database"), edge(A.id, STRIPE.id), edge(B.id, STRIPE.id)]);

  it("finds boundary crossings and the connected-to set", () => {
    const a = analyzeScope(g, pci);
    expect(a.crossings.map((c) => [edgeKey(c.edge), c.direction])).toEqual([
      ["service:pay>vendor:stripe:http", "out"],
      ["service:web>service:pay:http", "in"],
    ]);
    expect(a.connectedTo.map((n) => n.id)).toEqual(["service:web", "vendor:stripe"]);
    expect(a.members.map((n) => n.id).sort()).toEqual(["db:postgres", "service:pay"]);
  });

  it("reports scope members that no longer exist", () => {
    expect(analyzeScope(g, { ...pci, nodeIds: ["service:gone", "service:pay"] }).missing).toEqual(["service:gone"]);
  });

  it("suggests a scope from a data class and lists its flows", () => {
    const withPan = graph([A, DB, STRIPE], [
      edge(A.id, STRIPE.id, "http", { dataClasses: [{ class: "PAN", certainty: "evidenced", evidence: [] }] }),
      edge(A.id, DB.id, "database"),
    ]);
    expect(suggestScope(withPan, "PAN")).toEqual(["service:pay", "vendor:stripe"]);
    expect(dataFlows(withPan, "PAN")).toHaveLength(1);
    expect(suggestScope(withPan, "PHI")).toEqual([]);
  });
});

describe("policy", () => {
  it("parses a valid file and applies defaults", () => {
    const { policy, errors } = parsePolicy("on_drift: failure\nrules:\n  new_vendor: false\nignore:\n  - vendor:segment\n");
    expect(errors).toEqual([]);
    expect(policy.on_drift).toBe("failure");
    expect(ruleEnabled(policy, "new_vendor")).toBe(false);
    expect(ruleEnabled(policy, "public_exposure")).toBe(true);
    expect(policy.ignore).toEqual(["vendor:segment"]);
  });

  it("falls back to defaults and explains why on bad input", () => {
    expect(parsePolicy("on_drift: explode").errors[0]).toMatch(/on_drift/);
    expect(parsePolicy("a: [unclosed").errors[0]).toMatch(/not valid YAML/);
    expect(parsePolicy("a: [unclosed").policy).toEqual(defaultPolicy());
    expect(parsePolicy("").errors).toEqual([]);
    expect(parsePolicy(null).policy.on_drift).toBe("neutral");
  });

  it("lets settings from the app override the file field by field", () => {
    const file = parsePolicy("on_drift: neutral\nignore: [a]\nrules:\n  new_vendor: false\n").policy;
    const merged = mergePolicy(file, { on_drift: "failure", ignore: ["b"], rules: { public_exposure: false } });
    expect(merged.on_drift).toBe("failure");
    expect(merged.ignore).toEqual(["a", "b"]);
    expect(merged.rules).toEqual({ new_vendor: false, public_exposure: false });
    expect(mergePolicy(file, null)).toBe(file);
  });
});

describe("evaluateDrift", () => {
  const policy = (extra = "") => parsePolicy(`on_drift: failure\n${extra}`).policy;
  const base = graph([A, B, DB], [edge(A.id, DB.id, "database"), edge(B.id, A.id)]);

  it("reports nothing when nothing changed", () => {
    const r = evaluateDrift({ base, head: base, scopes: [pci], policy: policy() });
    expect(r.findings).toEqual([]);
    expect(r.conclusion).toBe("success");
    expect(r.summary).toBe("No scope drift detected.");
  });

  it("flags a new vendor, the data class that reaches it, and the boundary crossing", () => {
    const head = graph([A, B, DB, STRIPE], [
      edge(A.id, DB.id, "database"), edge(B.id, A.id),
      edge(A.id, STRIPE.id, "http", { dataClasses: [{ class: "PAN", certainty: "evidenced", evidence: [{ kind: "call-site", source: "pay.ts", detail: "x", line: 3 }] }] }),
    ]);
    const r = evaluateDrift({ base, head, scopes: [pci], policy: policy() });
    expect(r.findings.map((f) => f.rule).sort()).toEqual(["data_class_to_vendor", "new_vendor", "scope_boundary_crossing"]);
    expect(r.conclusion).toBe("failure");
    expect(r.findings.every((f) => f.severity === "high")).toBe(true);
    expect(r.summary).toBe("3 scope drift findings, 3 high severity.");
    expect(r.findings[0]!.key).toMatch(/^(data_class_to_vendor|new_vendor|scope_boundary_crossing):/);
  });

  it("does not report 'possible' data classes as drift", () => {
    const head = graph([A, B, DB, STRIPE], [
      edge(A.id, DB.id, "database"), edge(B.id, A.id),
      edge(A.id, STRIPE.id, "http", { dataClasses: [{ class: "PII", certainty: "possible", evidence: [] }] }),
    ]);
    const r = evaluateDrift({ base, head, scopes: [], policy: policy() });
    expect(r.findings.map((f) => f.rule)).toEqual(["new_vendor"]);
  });

  it("flags new public exposure, but not exposure that was already there", () => {
    const exp = { direction: "ingress" as const, cidr: "0.0.0.0/0", port: 443, source: "main.tf", line: 9 };
    const lb = node("tf:aws_lb.web", "loadbalancer", { public: true, exposure: [exp] });
    const open = node("tf:aws_db_instance.db", "database", { public: true, exposure: [{ ...exp, port: 5432 }] });
    const had = graph([lb], []);
    const now = graph([lb, open], []);
    const r = evaluateDrift({ base: had, head: now, scopes: [], policy: policy() });
    const exposure = r.findings.filter((f) => f.rule === "public_exposure");
    expect(exposure.map((f) => f.nodeIds[0])).toEqual(["tf:aws_db_instance.db"]);
    expect(exposure[0]!.severity).toBe("high");
    expect(exposure[0]!.evidence[0]).toMatchObject({ source: "main.tf", line: 9 });
    expect(evaluateDrift({ base: now, head: now, scopes: [], policy: policy() }).findings).toEqual([]);
  });

  it("reports one finding when the same range is open both on a port and on any port", () => {
    const db = node("tf:db", "database", { public: true, exposure: [
      { direction: "ingress", cidr: "0.0.0.0/0", port: null, source: "main.tf", line: 3 },
      { direction: "ingress", cidr: "0.0.0.0/0", port: 5432, source: "main.tf", line: 9 },
    ] });
    const r = evaluateDrift({ base: graph([]), head: graph([db]), scopes: [], policy: policy() });
    expect(r.findings.filter((f) => f.rule === "public_exposure").map((f) => f.key)).toEqual(["public_exposure:tf:db:ingress|0.0.0.0/0|5432"]);
  });

  it("flags nodes that became public without listed exposure (Ingress)", () => {
    const priv = graph([A], []);
    const pub = graph([{ ...A, public: true }], []);
    expect(evaluateDrift({ base: priv, head: pub, scopes: [], policy: policy() }).findings.map((f) => f.key)).toEqual(["public_exposure:service:pay:public"]);
  });

  it("flags datastore additions, removals and engine changes", () => {
    const q = node("queue:kafka", "queue", { engine: "kafka" });
    const r1 = evaluateDrift({ base, head: graph([A, B, DB, q]), scopes: [], policy: policy() });
    expect(r1.findings.map((f) => f.key)).toContain("datastore_change:added:queue:kafka");
    const r2 = evaluateDrift({ base, head: graph([A, B]), scopes: [], policy: policy() });
    expect(r2.findings.map((f) => f.key)).toContain("datastore_change:removed:db:postgres");
    const r3 = evaluateDrift({ base, head: graph([A, B, { ...DB, engine: "mysql" }]), scopes: [], policy: policy() });
    expect(r3.findings.map((f) => f.key)).toContain("datastore_change:engine:db:postgres");
  });

  it("flags new low-confidence connections that touch a scoped node", () => {
    const head = graph([A, B, DB], [edge(A.id, DB.id, "database"), edge(B.id, A.id), edge(B.id, DB.id, "database", { confidence: "low" })]);
    const r = evaluateDrift({ base, head, scopes: [pci], policy: policy("rules:\n  scope_boundary_crossing: false\n") });
    expect(r.findings.map((f) => f.rule)).toEqual(["low_confidence_in_scope"]);
    expect(r.findings[0]!.severity).toBe("low");
  });

  it("honours disabled rules and the ignore list, and reports ignored findings separately", () => {
    const head = graph([A, B, DB, STRIPE], [edge(A.id, DB.id, "database"), edge(B.id, A.id), edge(A.id, STRIPE.id)]);
    expect(evaluateDrift({ base, head, scopes: [], policy: policy("rules:\n  new_vendor: false\n") }).findings).toEqual([]);
    const r = evaluateDrift({ base, head, scopes: [], policy: policy("ignore:\n  - vendor:stripe\n") });
    expect(r.findings).toEqual([]);
    expect(r.ignored.map((f) => f.key)).toEqual(["new_vendor:vendor:stripe"]);
    expect(r.conclusion).toBe("success");
    expect(r.summary).toBe("No scope drift (1 accepted by policy).");
  });

  it("uses the neutral conclusion when the policy says so", () => {
    const head = graph([A, B, DB, STRIPE], [edge(A.id, DB.id, "database"), edge(B.id, A.id), edge(A.id, STRIPE.id)]);
    expect(evaluateDrift({ base, head, scopes: [], policy: parsePolicy("on_drift: neutral").policy }).conclusion).toBe("neutral");
  });

  it("fingerprints findings independent of order", () => {
    expect(driftFingerprint([{ key: "b" }, { key: "a" }])).toBe(driftFingerprint([{ key: "a" }, { key: "b" }]));
    expect(summarize([])).toBe("No scope drift detected.");
    expect(summarize([{ severity: "low" } as never])).toBe("1 scope drift finding.");
  });
});

describe("overrides", () => {
  const g = graph([A, B, DB], [edge(A.id, DB.id, "database", { confidence: "low" }), edge(B.id, A.id)]);
  const o = (extra: object): Override => ({ id: "o1", reason: "reviewed", actor: "kay", createdAt: "2026-01-01", ...extra }) as Override;

  it("confirms an edge, recording who and why", () => {
    const r = applyOverrides(g, [o({ kind: "confirm_edge", edgeId: edgeKey(g.edges[0]!) })]);
    expect(r.graph.edges[0]!.confidence).toBe("high");
    expect(r.graph.edges[0]!.evidence!.at(-1)).toMatchObject({ kind: "manual", detail: "Confirmed by kay: reviewed" });
    expect(g.edges[0]!.confidence).toBe("low"); // input untouched
  });

  it("hides edges and nodes", () => {
    const r = applyOverrides(g, [o({ kind: "hide_edge", edgeId: edgeKey(g.edges[1]!) }), o({ id: "o2", kind: "hide_node", nodeId: "db:postgres" })]);
    expect(r.graph.edges).toEqual([]);
    expect(r.graph.nodes.map((n) => n.id)).toEqual(["service:pay", "service:web"]);
  });

  it("adds a manual edge, or upgrades an existing one", () => {
    const added = applyOverrides(g, [o({ kind: "add_edge", from: B.id, to: DB.id, edgeType: "database" })]);
    expect(added.graph.edges.find((e) => e.from === B.id && e.to === DB.id)?.confidence).toBe("high");
    const upgraded = applyOverrides(g, [o({ kind: "add_edge", from: A.id, to: DB.id, edgeType: "database" })]);
    expect(upgraded.graph.edges.filter((e) => e.from === A.id && e.to === DB.id)).toHaveLength(1);
    expect(upgraded.graph.edges.find((e) => e.from === A.id)?.confidence).toBe("high");
  });

  it("sets and clears data classes on edges and nodes", () => {
    const set = applyOverrides(g, [o({ kind: "set_data_class", target: { kind: "edge", id: edgeKey(g.edges[0]!) }, class: "PHI", present: true })]);
    expect(set.graph.edges[0]!.dataClasses?.[0]).toMatchObject({ class: "PHI", certainty: "evidenced" });
    const cleared = applyOverrides(set.graph, [o({ id: "o3", createdAt: "2026-02-01", kind: "set_data_class", target: { kind: "edge", id: edgeKey(g.edges[0]!) }, class: "PHI", present: false })]);
    expect(cleared.graph.edges[0]!.dataClasses).toBeUndefined();
    const nodeSet = applyOverrides(g, [o({ kind: "set_data_class", target: { kind: "node", id: DB.id }, class: "PII", present: true })]);
    expect(nodeSet.graph.nodes.find((n) => n.id === DB.id)?.dataClasses?.[0]?.class).toBe("PII");
  });

  it("reports overrides that no longer match anything instead of dropping them silently", () => {
    const r = applyOverrides(g, [
      o({ kind: "confirm_edge", edgeId: "nope" }), o({ id: "x2", kind: "hide_edge", edgeId: "nope" }), o({ id: "x3", kind: "hide_node", nodeId: "gone" }),
      o({ id: "x4", kind: "add_edge", from: "gone", to: DB.id, edgeType: "http" }),
      o({ id: "x5", kind: "set_data_class", target: { kind: "node", id: "gone" }, class: "PII", present: true }),
    ]);
    expect(r.orphaned.map((x) => x.id)).toEqual(["o1", "x2", "x3", "x4", "x5"]);
    expect(r.applied).toEqual([]);
  });

  it("applies in order of creation", () => {
    const hide = o({ id: "a", createdAt: "2026-01-01", kind: "hide_edge", edgeId: edgeKey(g.edges[1]!) });
    const add = o({ id: "b", createdAt: "2026-01-02", kind: "add_edge", from: B.id, to: A.id, edgeType: "http" });
    expect(applyOverrides(g, [add, hide]).graph.edges.some((e) => e.from === B.id && e.to === A.id)).toBe(true);
  });
});

describe("vendor inventory", () => {
  const catalog = [{ id: "stripe", name: "Stripe", category: "payments", website: "https://stripe.com" }];
  const g = graph(
    [A, B, STRIPE, node("ext:api.example.io", "external", { name: "api.example.io" })],
    [
      edge(A.id, STRIPE.id, "http", { dataClasses: [{ class: "PAN", certainty: "evidenced", evidence: [] }, { class: "PII", certainty: "possible", evidence: [] }], evidence: [{ kind: "sdk-import", source: "a.ts", detail: "x", line: 1 }, { kind: "declared", source: ".env.example", detail: "y" }] }),
      edge(B.id, STRIPE.id, "http", { confidence: "medium" }),
      edge(A.id, "ext:api.example.io", "http", { confidence: "low" }),
    ]
  );

  it("lists catalog vendors and unknown hosts with usage, data classes and confidence", () => {
    const rows = buildVendorInventory(g, catalog, [{ vendorId: "stripe", purpose: "Card payments", region: "US", dpaOnFile: true }]);
    expect(rows.map((r) => r.name).sort()).toEqual(["Stripe", "api.example.io"]);
    const stripe = rows.find((r) => r.name === "Stripe")!;
    expect(stripe.usedBy.map((u) => u.name)).toEqual(["pay", "web"]);
    expect(stripe.evidencedClasses).toEqual(["PAN"]);
    expect(stripe.possibleClasses).toEqual(["PII"]);
    expect(stripe.confidence).toBe("high");
    expect(stripe.evidence.some((e) => e.kind === "declared")).toBe(false);
    expect(stripe).toMatchObject({ purpose: "Card payments", region: "US", dpaOnFile: true, category: "payments" });
    expect(rows.find((r) => r.name === "api.example.io")).toMatchObject({ kind: "external", category: "unclassified", confidence: "low", dpaOnFile: null });
  });

  it("writes CSV with proper quoting, and marks the DORA register as an assist", () => {
    expect(toCsv([["a", 'b,"c"', "d\ne"]])).toBe('a,"b,""c""","d\ne"\r\n');
    const rows = buildVendorInventory(g, catalog);
    const csv = vendorInventoryCsv(rows);
    expect(csv.split("\r\n")[0]).toContain("Data classes (evidenced)");
    expect(csv).toContain("Stripe,payments,https://stripe.com,pay; web,PAN,PII,high");
    const dora = doraRegisterAssistCsv(rows);
    expect(dora).toContain("Assist only: verify before submission");
    expect(dora.trim().split("\r\n")).toHaveLength(3);
    expect(dora).toContain("PII (possible)");
  });
});

describe("impact", () => {
  const g = graph([A, B, DB, STRIPE, node("service:.", "service", { path: "." })], [
    edge(B.id, A.id), edge(A.id, DB.id, "database"), edge(A.id, STRIPE.id), edge(node("internet", "network").id, B.id, "network"),
  ]);

  it("finds transitive dependents, excluding the internet", () => {
    expect(dependentsOf(g, DB.id).map((n) => n.id)).toEqual(["service:pay", "service:web"]);
    expect(dependentsOf(g, B.id)).toEqual([]);
  });

  it("scores risk from fan-in, fan-out and blast radius", () => {
    expect(nodeRisk(g, DB.id)).toMatchObject({ inbound: 1, blastRadius: 2, risk: "medium" });
    expect(nodeRisk(g, "service:.").risk).toBe("low");
  });

  it("maps changed files to the deepest owning service and collects downstream and upstream effects", () => {
    const rules = parseCodeowners("services/pay/ @payments-team\n*.md @docs\n");
    const impact = analyzeChangedFiles(g, ["services/pay/src/a.ts", "services/pay/b.ts", "scripts/x.sh"], (p) => matchOwnersForPath(p, rules));
    expect(impact.touched.map((t) => [t.id, t.changedFiles.length])).toEqual([["service:pay", 2], ["service:.", 1]]);
    expect(impact.unmatchedFiles).toEqual([]);
    expect(impact.suggestedReviewers).toEqual(["@payments-team"]);
    expect(impact.affectedVendors).toEqual(["Stripe"]);
    expect(impact.affectedDataStores).toEqual(["postgres"]);
    expect(impact.affectedDependents).toEqual(["web"]);
    expect(impact.summary).toMatch(/pay is the main touched service/);
  });

  it("reports files that match no service when there is no root service", () => {
    const noRoot = graph([A, B, DB]);
    const impact = analyzeChangedFiles(noRoot, ["README.md"]);
    expect(impact.unmatchedFiles).toEqual(["README.md"]);
    expect(impact.summary).toMatch(/No changed file maps/);
  });
});

describe("codeowners", () => {
  it("uses the last matching rule, directory patterns, wildcards and anchoring", () => {
    const rules = parseCodeowners("# c\n* @everyone\n/docs/ @docs\n*.sql @dba\napps/web/** @web\n/build.sh @ops\n");
    expect(matchOwnersForPath("src/a.ts", rules)).toEqual(["@everyone"]);
    expect(matchOwnersForPath("docs/guide/x.md", rules)).toEqual(["@docs"]);
    expect(matchOwnersForPath("db/001.sql", rules)).toEqual(["@dba"]);
    expect(matchOwnersForPath("apps/web/app/page.tsx", rules)).toEqual(["@web"]);
    expect(matchOwnersForPath("build.sh", rules)).toEqual(["@ops"]);
    expect(matchOwnersForPath("other/build.sh", rules)).toEqual(["@everyone"]);
    expect(parseCodeowners("onlypattern\n")).toEqual([]);
  });
});
