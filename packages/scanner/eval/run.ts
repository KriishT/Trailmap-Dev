/**
 * Accuracy evaluation for the scanner.
 *
 *   npm run eval
 *
 * Scans every fixture in ../fixtures and compares the graph with the fixture's hand-written
 * expected.json. Prints precision / recall per edge category, vendor and data-class detection,
 * writes docs/accuracy.md, and exits non-zero when the CI thresholds are not met.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/index.js";
import { SCANNER_VERSION } from "../src/assemble.js";
import type { DependencyGraph } from "@trailmap/graph";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "fixtures");
const docsFile = path.join(here, "..", "..", "..", "docs", "accuracy.md");
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

const MIN_PRECISION = 0.9;
const MIN_RECALL = 0.8;
const GATED = ["service->service", "service->vendor"] as const;

interface Expected {
  description?: string;
  mode?: "regression";
  /** For regression fixtures: directory to scan, relative to the fixture. */
  source?: string;
  nodes?: Array<{ id: string; type: string }>;
  edges?: Array<{ from: string; to: string; type: string }>;
  vendors?: string[];
  dataClasses?: Array<{ from: string; to: string; class: string }>;
  publicNodes?: string[];
  /** Regression only: edges that must exist, and "from>to" regexes that must not match any edge. */
  mustHave?: Array<{ from: string; to: string; type: string }>;
  forbidden?: string[];
  nodeTypes?: Record<string, string>;
}

interface Counts { tp: number; fp: number; fn: number }
const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0 });
const add = (a: Counts, b: Counts) => { a.tp += b.tp; a.fp += b.fp; a.fn += b.fn; };
const precision = (c: Counts) => (c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp));
const recall = (c: Counts) => (c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn));
const pct = (x: number) => (x * 100).toFixed(1) + "%";

function compare(expected: Set<string>, actual: Set<string>): Counts {
  const c = zero();
  for (const e of expected) (actual.has(e) ? c.tp++ : c.fn++);
  for (const a of actual) if (!expected.has(a)) c.fp++;
  return c;
}

function categoryOf(graph: DependencyGraph, from: string, to: string, type: string): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const target = byId.get(to);
  if (type === "network") return "network";
  switch (target?.type) {
    case "service": case "library": case "function": return "service->service";
    case "saas": case "external": return "service->vendor";
    case "database": case "storage": return "service->datastore";
    case "queue": return "service->queue";
    default: return "other";
  }
}

interface FixtureResult {
  name: string;
  description: string;
  regression: boolean;
  nodes: Counts;
  edges: Counts;
  vendors: Counts;
  dataClasses: Counts;
  publicNodes: Counts;
  byCategory: Map<string, Counts>;
  byType: Map<string, Counts>;
  falsePositives: string[];
  falseNegatives: string[];
  problems: string[];
  possibleTags: number;
  deterministic: boolean;
  ms: number;
}

async function evaluate(name: string): Promise<FixtureResult> {
  const dir = path.join(fixturesDir, name);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8")) as Expected;
  const regression = expected.mode === "regression";
  const root = regression ? path.resolve(dir, expected.source ?? ".") : path.join(dir, "repo");

  const t0 = Date.now();
  const graph = await scan({ rootDir: root, scannedAt: FIXED_TIME, repoName: `fixtures/${name}` });
  const ms = Date.now() - t0;
  const again = await scan({ rootDir: root, scannedAt: FIXED_TIME, repoName: `fixtures/${name}` });
  const deterministic = JSON.stringify(graph) === JSON.stringify(again);

  const result: FixtureResult = {
    name, description: expected.description ?? "", regression,
    nodes: zero(), edges: zero(), vendors: zero(), dataClasses: zero(), publicNodes: zero(),
    byCategory: new Map(), byType: new Map(), falsePositives: [], falseNegatives: [], problems: [],
    possibleTags: 0, deterministic, ms,
  };
  if (!deterministic) result.problems.push("output is not deterministic");

  const edgeKey = (e: { from: string; to: string; type: string }) => `${e.from} -> ${e.to} [${e.type}]`;
  const actualEdges = new Set(graph.edges.map(edgeKey));

  if (regression) {
    for (const need of expected.mustHave ?? []) {
      if (!actualEdges.has(edgeKey(need))) result.problems.push(`missing required edge ${edgeKey(need)}`);
    }
    for (const pattern of expected.forbidden ?? []) {
      const re = new RegExp(pattern);
      for (const e of graph.edges) {
        const k = `${e.from}>${e.to}`;
        if (re.test(k)) result.problems.push(`forbidden edge present: ${edgeKey(e)} (matches ${pattern})`);
      }
    }
    for (const [id, type] of Object.entries(expected.nodeTypes ?? {})) {
      const n = graph.nodes.find((x) => x.id === id);
      if (!n) result.problems.push(`missing node ${id}`);
      else if (n.type !== type) result.problems.push(`node ${id} is ${n.type}, expected ${type}`);
    }
    return result;
  }

  result.nodes = compare(
    new Set((expected.nodes ?? []).map((n) => `${n.id}:${n.type}`)),
    new Set(graph.nodes.map((n) => `${n.id}:${n.type}`))
  );
  const expEdges = new Set((expected.edges ?? []).map(edgeKey));
  result.edges = compare(expEdges, actualEdges);
  for (const e of actualEdges) if (!expEdges.has(e)) result.falsePositives.push(e);
  for (const e of expEdges) if (!actualEdges.has(e)) result.falseNegatives.push(e);

  const cat = (e: { from: string; to: string; type: string }) => categoryOf(graph, e.from, e.to, e.type);
  const groups = new Map<string, { exp: Set<string>; act: Set<string> }>();
  const bump = (m: Map<string, { exp: Set<string>; act: Set<string> }>, key: string, side: "exp" | "act", k: string) => {
    const g = m.get(key) ?? { exp: new Set(), act: new Set() };
    g[side].add(k);
    m.set(key, g);
  };
  const typeGroups = new Map<string, { exp: Set<string>; act: Set<string> }>();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const catOfExpected = (e: { from: string; to: string; type: string }) => {
    const t = (expected.nodes ?? []).find((n) => n.id === e.to)?.type;
    if (e.type === "network") return "network";
    if (t === "service" || t === "library" || t === "function") return "service->service";
    if (t === "saas" || t === "external") return "service->vendor";
    if (t === "database" || t === "storage") return "service->datastore";
    if (t === "queue") return "service->queue";
    return "other";
  };
  for (const e of expected.edges ?? []) { bump(groups, catOfExpected(e), "exp", edgeKey(e)); bump(typeGroups, e.type, "exp", edgeKey(e)); }
  for (const e of graph.edges) { bump(groups, cat(e), "act", edgeKey(e)); bump(typeGroups, e.type, "act", edgeKey(e)); }
  for (const [k, g] of groups) result.byCategory.set(k, compare(g.exp, g.act));
  for (const [k, g] of typeGroups) result.byType.set(k, compare(g.exp, g.act));

  result.vendors = compare(
    new Set(expected.vendors ?? []),
    new Set(graph.nodes.filter((n) => n.type === "saas" && n.vendor).map((n) => n.vendor!))
  );

  const expTags = new Set((expected.dataClasses ?? []).map((d) => `${d.from} -> ${d.to} ${d.class}`));
  const actTags = new Set<string>();
  for (const e of graph.edges) {
    for (const t of e.dataClasses ?? []) {
      if (t.certainty === "evidenced") actTags.add(`${e.from} -> ${e.to} ${t.class}`);
      else result.possibleTags++;
    }
  }
  result.dataClasses = compare(expTags, actTags);
  for (const t of actTags) if (!expTags.has(t)) result.falsePositives.push(`data class ${t}`);
  for (const t of expTags) if (!actTags.has(t)) result.falseNegatives.push(`data class ${t}`);

  result.publicNodes = compare(
    new Set(expected.publicNodes ?? []),
    new Set([...nodeById.values()].filter((n) => n.public).map((n) => n.id))
  );
  return result;
}

/** A synthetic 2,000-file repository, to check the speed requirement. */
async function benchmark(): Promise<{ files: number; ms: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-bench-"));
  try {
    let files = 0;
    for (let s = 0; s < 20; s++) {
      const svc = path.join(dir, "services", `svc${s}`);
      fs.mkdirSync(path.join(svc, "src"), { recursive: true });
      fs.writeFileSync(path.join(svc, "package.json"), JSON.stringify({ name: `svc${s}`, scripts: { start: "node index.js" }, dependencies: { express: "^4", pg: "^8" } }));
      files++;
      for (let i = 0; i < 99; i++) {
        const body = [
          `import express from "express";`,
          `import { Pool } from "pg";`,
          `import { helper${i} } from "./util${(i + 1) % 99}";`,
          `const pool = new Pool({ connectionString: process.env.DATABASE_URL });`,
          `export function handler${i}() { return fetch("http://svc${(s + 1) % 20}:3000/api/${i}"); }`,
          ...Array.from({ length: 30 }, (_, k) => `export const value${k} = ${k}; // filler line ${k}`),
        ].join("\n");
        fs.writeFileSync(path.join(svc, "src", `util${i}.ts`), body);
        files++;
      }
    }
    const t0 = Date.now();
    await scan({ rootDir: dir, scannedAt: FIXED_TIME });
    return { files, ms: Date.now() - t0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function row(label: string, c: Counts): string {
  return `| ${label} | ${c.tp} | ${c.fp} | ${c.fn} | ${pct(precision(c))} | ${pct(recall(c))} |`;
}

async function main() {
  const names = fs.readdirSync(fixturesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const results: FixtureResult[] = [];
  for (const n of names) results.push(await evaluate(n));
  const scored = results.filter((r) => !r.regression);

  const pooled = { nodes: zero(), edges: zero(), vendors: zero(), dataClasses: zero(), publicNodes: zero() };
  const cats = new Map<string, Counts>();
  const types = new Map<string, Counts>();
  for (const r of scored) {
    add(pooled.nodes, r.nodes); add(pooled.edges, r.edges); add(pooled.vendors, r.vendors);
    add(pooled.dataClasses, r.dataClasses); add(pooled.publicNodes, r.publicNodes);
    for (const [k, c] of r.byCategory) add(cats.get(k) ?? cats.set(k, zero()).get(k)!, c);
    for (const [k, c] of r.byType) add(types.get(k) ?? types.set(k, zero()).get(k)!, c);
  }

  const failures: string[] = [];
  for (const g of GATED) {
    const c = cats.get(g) ?? zero();
    if (precision(c) < MIN_PRECISION) failures.push(`${g} precision ${pct(precision(c))} < ${pct(MIN_PRECISION)}`);
    if (recall(c) < MIN_RECALL) failures.push(`${g} recall ${pct(recall(c))} < ${pct(MIN_RECALL)}`);
  }
  for (const r of results) {
    for (const p of r.problems) failures.push(`${r.name}: ${p}`);
    if (!r.regression && r.edges.fp > 0 && /trap/.test(r.name)) failures.push(`${r.name}: ${r.edges.fp} phantom edge(s)`);
  }

  const bench = await benchmark();
  if (bench.ms > 30_000) failures.push(`2,000-file scan took ${bench.ms} ms (limit 30000)`);

  const md: string[] = [];
  md.push("# Scanner accuracy", "");
  md.push(`Generated by \`npm run eval\` for scanner ${SCANNER_VERSION}. Do not edit by hand.`, "");
  md.push(
    "Each fixture under `packages/scanner/fixtures/<name>/repo` has a hand-written `expected.json`. " +
      "Precision is the share of reported items that are correct; recall is the share of real items that were found. " +
      `CI fails if service to service or service to vendor precision drops below ${pct(MIN_PRECISION)}, or recall below ${pct(MIN_RECALL)}, ` +
      "if any fixture's output is not byte-identical across runs, or if the trap repository or this repository produce a phantom connection.",
    ""
  );
  md.push(
    "## How to read these numbers",
    "",
    "The fixtures were written together with the scanner, so they describe the situations it was built for. " +
      "Perfect scores here show that those situations are handled and that nothing regressed; they are not an estimate of accuracy on an arbitrary codebase, which will be lower. " +
      "Every fixture is a small, single-purpose repository; real repositories add dynamic URLs built at runtime, service discovery through a registry, " +
      "infrastructure modules from other repositories and code generation, none of which static analysis can fully resolve. " +
      "Treat `low` and `medium` confidence edges as prompts to review, and use the overrides in the product to confirm or hide them.",
    ""
  );
  md.push("## Pooled results", "", "| Measure | TP | FP | FN | Precision | Recall |", "|---|---|---|---|---|---|");
  md.push(row("Nodes", pooled.nodes), row("Edges (all)", pooled.edges));
  for (const k of [...cats.keys()].sort()) md.push(row(`Edges: ${k}${(GATED as readonly string[]).includes(k) ? " (gated)" : ""}`, cats.get(k)!));
  for (const k of [...types.keys()].sort()) md.push(row(`Edge type: ${k}`, types.get(k)!));
  md.push(row("Vendor detection", pooled.vendors), row("Data classes (evidenced)", pooled.dataClasses), row("Public exposure", pooled.publicNodes));
  md.push("", "## Per fixture", "", "| Fixture | Edges TP/FP/FN | Vendors | Data classes | Deterministic | Scan time |", "|---|---|---|---|---|---|");
  for (const r of results) {
    if (r.regression) {
      md.push(`| ${r.name} (regression) | ${r.problems.length === 0 ? "pass" : `${r.problems.length} problem(s)`} | - | - | ${r.deterministic ? "yes" : "NO"} | ${r.ms} ms |`);
    } else {
      md.push(`| ${r.name} | ${r.edges.tp}/${r.edges.fp}/${r.edges.fn} | ${r.vendors.tp}/${r.vendors.fp}/${r.vendors.fn} | ${r.dataClasses.tp}/${r.dataClasses.fp}/${r.dataClasses.fn} | ${r.deterministic ? "yes" : "NO"} | ${r.ms} ms |`);
    }
  }
  md.push("", `Speed check: a synthetic ${bench.files}-file repository scanned in ${bench.ms} ms (limit 30000 ms).`, "");
  const misses = results.filter((r) => r.falsePositives.length || r.falseNegatives.length || r.problems.length);
  if (misses.length) {
    md.push("## Known misses", "");
    for (const r of misses) {
      md.push(`### ${r.name}`, "");
      for (const x of r.falsePositives) md.push(`- false positive: ${x}`);
      for (const x of r.falseNegatives) md.push(`- missed: ${x}`);
      for (const x of r.problems) md.push(`- problem: ${x}`);
      md.push("");
    }
  }
  fs.mkdirSync(path.dirname(docsFile), { recursive: true });
  fs.writeFileSync(docsFile, md.join("\n"));

  console.log(md.join("\n"));
  if (failures.length) {
    console.error("\nEVAL FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log("\nEval passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
