import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvidencePack } from "./evidence";
import { renderVendorsTable, collectVendors } from "./vendors";
import { renderDriftReport } from "./check";
import { remoteCheck, uploadSnapshot } from "./remote";
import { table } from "./format";

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, "..", "dist", "bin.js");
const fixtures = path.join(here, "..", "..", "scanner", "fixtures");
const fixture = (name: string) => path.join(fixtures, name, "repo");

const run = (args: string[], cwd?: string) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const temps: string[] = [];
const temp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
};
afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("trailmap vendors (built binary)", () => {
  it("prints the vendor inventory with data classes and the code line that proves each one", () => {
    const r = run(["vendors", fixture("ts-microservices")]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        "Vendor   Category   Used by   Data (evidenced)  Data (possible)  Confidence  Evidence",
        "-------  ---------  --------  ----------------  ---------------  ----------  --------------------------------",
        "Segment  analytics  payments  PII               -                high        services/payments/src/index.ts:4",
        "Stripe   payments   payments  PAN               PII              high        services/payments/src/index.ts:3",
        "",
        "2 vendors found, 2 with data classes seen at a call site. Run with --csv for a spreadsheet.",
        "",
      ].join("\n")
    );
  });

  it("explains an empty result instead of printing an empty table", () => {
    const r = run(["vendors", fixture("trap-repo")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("No third-party vendors or subprocessors detected.");
  });

  it("prints CSV and JSON", () => {
    const csv = run(["vendors", fixture("python-fastapi"), "--csv"]).out;
    expect(csv.split("\r\n")[0]).toBe("Vendor,Category,Website,Used by,Data classes (evidenced),Data classes (possible),Confidence,Purpose,Region,DPA on file,Notes");
    expect(csv).toContain("SendGrid,email,https://sendgrid.com");
    const json = JSON.parse(run(["vendors", fixture("python-fastapi"), "--json"]).out) as Array<{ vendorId: string }>;
    expect(json.map((v) => v.vendorId)).toEqual(["sendgrid"]);
  });

  it("fails clearly for a directory that does not exist", () => {
    const r = run(["scan", path.join(os.tmpdir(), "nope-trailmap-xyz")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Directory not found");
  });
});

describe("trailmap scan (built binary)", () => {
  it("writes JSON with the schema version, hash and evidence lines", () => {
    const r = run(["scan", fixture("go-kafka-redis")]);
    const graph = JSON.parse(r.out);
    expect(graph.meta.graphSchemaVersion).toBeGreaterThanOrEqual(2);
    expect(graph.meta.graphHash).toMatch(/^[0-9a-f]{64}$/);
    expect(graph.edges.map((e: { to: string }) => e.to).sort()).toEqual(["db:redis", "queue:kafka"]);
  });

  it("renders C4 and HTML output", () => {
    expect(run(["scan", fixture("go-kafka-redis"), "-o", "c4"]).out).toContain("softwareSystem");
    expect(run(["scan", fixture("go-kafka-redis"), "-o", "html"]).out).toContain("<!DOCTYPE html>");
  });
});

describe("trailmap check (built binary, real git)", () => {
  function repoWith(headPolicy: string) {
    const dir = temp("trailmap-cli-check-");
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...a], { cwd: dir, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "billing", scripts: { start: "node a.js" }, dependencies: { pg: "^8" } }));
    fs.writeFileSync(path.join(dir, "a.js"), 'import { Pool } from "pg";\nnew Pool({ connectionString: process.env.DATABASE_URL });\n');
    git("add", ".");
    git("commit", "-q", "-m", "base");
    fs.writeFileSync(path.join(dir, "pay.js"), 'import Stripe from "stripe";\nnew Stripe(process.env.STRIPE_SECRET_KEY);\n');
    if (headPolicy) fs.writeFileSync(path.join(dir, ".trailmap.yml"), headPolicy);
    git("add", ".");
    git("commit", "-q", "-m", "add stripe");
    return dir;
  }

  it("fails the job and prints the finding when the policy says failure", () => {
    const dir = repoWith('on_drift: failure\nscopes:\n  - name: "PCI CDE"\n    nodes: ["service:.", "db:postgres"]\n');
    const r = run(["check", ".", "--base", "HEAD~1"], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Trailmap scope check: failure");
    expect(r.out).toContain("[HIGH] New connection crosses the \"PCI CDE\" boundary");
    expect(r.out).toContain("[MEDIUM] New third-party vendor: Stripe");
    expect(r.out).toMatch(/evidence: pay\.js:1/);
  });

  it("exits 0 with a neutral result by default, and prints JSON on request", () => {
    const dir = repoWith("");
    const r = run(["check", ".", "--base", "HEAD~1"], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Trailmap scope check: neutral");
    const j = JSON.parse(run(["check", ".", "--base", "HEAD~1", "--json"], dir).out);
    expect(j.conclusion).toBe("neutral");
    expect(j.findings.map((f: { rule: string }) => f.rule)).toContain("new_vendor");
  });

  it("passes when nothing architectural changed", () => {
    const dir = repoWith("on_drift: failure\n");
    const r = run(["check", ".", "--base", "HEAD"], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Trailmap scope check: success");
  });

  it("explains an unknown git ref, and leaves no worktree behind", () => {
    const dir = repoWith("");
    const r = run(["check", ".", "--base", "origin/nope"], dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Cannot find git ref "origin/nope"');
    expect(execFileSync("git", ["worktree", "list"], { cwd: dir }).toString().trim().split("\n")).toHaveLength(1);
  });

  it("removes its temporary worktree after a successful run", () => {
    const dir = repoWith("");
    run(["check", ".", "--base", "HEAD~1"], dir);
    expect(execFileSync("git", ["worktree", "list"], { cwd: dir }).toString().trim().split("\n")).toHaveLength(1);
  });
});

describe("trailmap evidence", () => {
  it("writes a pack whose manifest hashes match the files, and states what to verify", async () => {
    const out = temp("trailmap-pack-");
    const r = await buildEvidencePack({ dir: fixture("ts-microservices"), framework: "pci", outDir: out, preparedBy: "kay" });
    expect(r.files).toEqual(["README.md", "data-flows.md", "evidence-appendix.md", "graph.json", "manifest.json", "vendors.csv"]);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    for (const [name, hash] of Object.entries(manifest.files as Record<string, string>)) {
      expect(createHash("sha256").update(fs.readFileSync(path.join(out, name), "utf8")).digest("hex"), name).toBe(hash);
    }
    expect(manifest).toMatchObject({ preparedBy: "kay", framework: { id: "pci-dss", version: "4.0.1" } });
    expect(manifest.requirements.map((q: { id: string }) => q.id)).toEqual(["1.2.3", "1.2.4", "12.5.2"]);
    const readme = fs.readFileSync(path.join(out, "README.md"), "utf8");
    expect(readme).toContain("does not certify compliance");
    expect(readme).toContain(manifest.graphHash);
    expect(fs.readFileSync(path.join(out, "data-flows.md"), "utf8")).toMatch(/## PAN[\s\S]*payments/);
    expect(fs.readFileSync(path.join(out, "evidence-appendix.md"), "utf8")).toContain("services/payments/src/index.ts:3");
  });

  it("adds the DORA register assist, clearly marked, for the dora framework", async () => {
    const out = temp("trailmap-pack-");
    const r = await buildEvidencePack({ dir: fixture("python-fastapi"), framework: "dora", outDir: out });
    expect(r.files).toContain("dora-register-assist.csv");
    expect(fs.readFileSync(path.join(out, "dora-register-assist.csv"), "utf8")).toContain("Assist only: verify before submission");
  });

  it("rejects an unknown framework", async () => {
    await expect(buildEvidencePack({ dir: fixture("trap-repo"), framework: "hipaa", outDir: temp("x-") })).rejects.toThrow(/Unknown framework/);
    const r = run(["evidence", fixture("trap-repo"), "-f", "hipaa"]);
    expect(r.code).toBe(1);
  });

  it("works from the command line", () => {
    const out = temp("trailmap-pack-");
    const r = run(["evidence", fixture("python-fastapi"), "-f", "soc2", "-o", out]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("SOC 2");
    expect(fs.existsSync(path.join(out, "manifest.json"))).toBe(true);
  });
});

describe("CI-only upload", () => {
  const opts = { apiUrl: "https://api.example.test/", apiKey: "tmk_00000000_x", repoId: "r1" };

  it("sends only the graph, with the key as a bearer token", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ snapshotId: "s1", graphHash: "h" }), { status: 201 });
    });
    const { graph } = await collectVendors({ dir: fixture("go-kafka-redis") });
    const r = await uploadSnapshot({ ...opts, graph, commitSha: "abc", branch: "main" });
    expect(r).toEqual({ snapshotId: "s1", graphHash: "h" });
    expect(seen!.url).toBe("https://api.example.test/api/ingest/r1");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer tmk_00000000_x");
    const body = JSON.parse(seen!.init.body as string);
    expect(Object.keys(body).sort()).toEqual(["branch", "commitSha", "graph"]);
    expect(JSON.stringify(body)).not.toContain("KAFKA_BROKERS=");
  });

  it("surfaces API errors and returns the server's drift verdict", async () => {
    const { graph } = await collectVendors({ dir: fixture("go-kafka-redis") });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Invalid or missing API key" }), { status: 401 }));
    await expect(uploadSnapshot({ ...opts, graph })).rejects.toThrow(/401: Invalid or missing API key/);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ conclusion: "failure", summary: "1 scope drift finding.", findings: [], ignored: 0, policyErrors: [] }), { status: 200 }));
    expect((await remoteCheck({ ...opts, graph, prNumber: 4, headSha: "sha" })).conclusion).toBe("failure");
  });
});

describe("formatting helpers", () => {
  it("aligns table columns and handles empty input", () => {
    expect(table(["A", "BB"], [["xxx", "y"]])).toBe("A    BB\n---  --\nxxx  y");
    expect(renderVendorsTable([])).toContain("No third-party vendors");
  });

  it("renders a report with ignored findings and policy problems", () => {
    const out = renderDriftReport(
      { findings: [], ignored: [{} as never, {} as never], conclusion: "success", summary: "No scope drift (2 accepted by policy)." },
      ["on_drift: bad value"]
    );
    expect(out).toContain("2 findings accepted by .trailmap.yml");
    expect(out).toContain("policy: on_drift: bad value");
  });
});
