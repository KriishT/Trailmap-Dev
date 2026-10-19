import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prepareGraphForWrite, computeGraphHash, type DependencyGraph } from "@trailmap/graph";
import { scan } from "./scanner";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "fixtures");
const T0 = "2026-01-01T00:00:00.000Z";

interface Expected {
  mode?: string;
  nodes?: Array<{ id: string; type: string }>;
  edges?: Array<{ from: string; to: string; type: string }>;
}

const fixtureNames = fs
  .readdirSync(fixturesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const expectedOf = (name: string): Expected =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name, "expected.json"), "utf8"));

const scanFixture = (name: string, extra: Record<string, unknown> = {}) =>
  scan({ rootDir: path.join(fixturesDir, name, "repo"), scannedAt: T0, repoName: `fixtures/${name}`, ...extra });

describe("fixture corpus", () => {
  for (const name of fixtureNames.filter((n) => expectedOf(n).mode !== "regression")) {
    it(`${name}: nodes and edges match expected.json exactly`, async () => {
      const exp = expectedOf(name);
      const g = await scanFixture(name);
      expect(g.nodes.map((n) => `${n.id}:${n.type}`).sort()).toEqual((exp.nodes ?? []).map((n) => `${n.id}:${n.type}`).sort());
      expect(g.edges.map((e) => `${e.from}>${e.to}:${e.type}`).sort()).toEqual((exp.edges ?? []).map((e) => `${e.from}>${e.to}:${e.type}`).sort());
    });
  }

  it("trap-repo produces no connections at all", async () => {
    const g = await scanFixture("trap-repo");
    expect(g.edges).toEqual([]);
    expect(g.nodes.map((n) => n.id)).toEqual(["service:."]);
  });
});

describe("output properties", () => {
  it("is byte-identical for the same input and a fixed timestamp", async () => {
    const a = JSON.stringify(await scanFixture("ts-microservices"));
    const b = JSON.stringify(await scanFixture("ts-microservices"));
    expect(a).toBe(b);
  });

  it("keeps the same graph hash and edge ids when only the scan time differs", async () => {
    const a = await scanFixture("ts-microservices");
    const b = await scanFixture("ts-microservices", { scannedAt: "2030-06-06T00:00:00.000Z" });
    expect(a.meta.graphHash).toBe(b.meta.graphHash);
    expect(a.edges.map((e) => e.id)).toEqual(b.edges.map((e) => e.id));
  });

  it("stamps a hash that matches the content, the scanner version and the schema version", async () => {
    const g = await scanFixture("python-fastapi");
    expect(g.meta.graphHash).toBe(computeGraphHash(g));
    expect(g.meta.scannerVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(g.meta.graphSchemaVersion).toBeGreaterThanOrEqual(2);
  });

  it("produces a graph the shared schema accepts, for every fixture", async () => {
    for (const name of fixtureNames.filter((n) => expectedOf(n).mode !== "regression")) {
      const g = await scanFixture(name);
      expect(() => prepareGraphForWrite(g), name).not.toThrow();
    }
  });

  it("gives every edge a stable id and sorts nodes and edges", async () => {
    const g = await scanFixture("ts-microservices");
    expect(g.edges.every((e) => /^e_[0-9a-f]{12}$/.test(e.id ?? ""))).toBe(true);
    expect(g.nodes.map((n) => n.id)).toEqual([...g.nodes.map((n) => n.id)].sort((a, b) => a.localeCompare(b)));
  });

  it("cites a file, line and short snippet for evidence from code", async () => {
    const g = await scanFixture("ts-microservices");
    const e = g.edges.find((x) => x.from === "service:services/payments" && x.to === "vendor:stripe")!;
    const imp = e.evidence!.find((x) => x.kind === "sdk-import")!;
    expect(imp.source).toBe("services/payments/src/index.ts");
    expect(imp.line).toBeGreaterThan(0);
    expect(imp.snippet).toContain("stripe");
    for (const ev of g.edges.flatMap((x) => x.evidence ?? [])) {
      if (ev.snippet) expect(ev.snippet.length).toBeLessThanOrEqual(120);
    }
  });

  it("never copies credentials from connection strings into evidence", async () => {
    const g = await scanFixture("ts-microservices");
    const blob = JSON.stringify(g);
    expect(blob).not.toContain("secret@db");
    expect(blob).not.toContain("sk_test_placeholder");
  });
});

describe("options", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const makeRepo = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-scan-test-"));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  };

  it("ignores test files unless includeTests is set", async () => {
    const dir = makeRepo({
      "package.json": JSON.stringify({ name: "app", scripts: { start: "node a.js" } }),
      "a.js": "console.log(1)",
      "a.test.js": 'import Stripe from "stripe"; new Stripe(process.env.STRIPE_SECRET_KEY);',
    });
    expect((await scan({ rootDir: dir, scannedAt: T0 })).edges).toEqual([]);
    const withTests = await scan({ rootDir: dir, scannedAt: T0, includeTests: true });
    expect(withTests.edges.map((e) => e.to)).toContain("vendor:stripe");
  });

  it("applies extra exclude patterns", async () => {
    const dir = makeRepo({
      "package.json": JSON.stringify({ name: "app", scripts: { start: "node a.js" } }),
      "a.js": "console.log(1)",
      "gen/client.js": 'import Stripe from "stripe"; new Stripe(process.env.STRIPE_SECRET_KEY);',
    });
    expect((await scan({ rootDir: dir, scannedAt: T0 })).edges.length).toBeGreaterThan(0);
    expect((await scan({ rootDir: dir, scannedAt: T0, exclude: ["gen/**"] })).edges).toEqual([]);
  });

  it("names the root service after repoName instead of the directory", async () => {
    const dir = makeRepo({ "package.json": JSON.stringify({ name: "x", scripts: { start: "a" } }), "a.js": "1" });
    const g = await scan({ rootDir: dir, scannedAt: T0, repoName: "acme/billing" });
    expect(g.meta.repo).toBe("acme/billing");
    expect(g.nodes[0]!.name).toBe("billing");
    expect(g.nodes[0]!.id).toBe("service:.");
  });

  it("keeps node ids stable when unrelated files are added", async () => {
    const dir = makeRepo({ "package.json": JSON.stringify({ name: "x", scripts: { start: "a" } }), "a.js": "1" });
    const before = (await scan({ rootDir: dir, scannedAt: T0 })).nodes.map((n) => n.id);
    fs.writeFileSync(path.join(dir, "b.js"), "2");
    const after = (await scan({ rootDir: dir, scannedAt: T0 })).nodes.map((n) => n.id);
    expect(after).toEqual(before);
  });

  it("emits third-party libraries only when asked", async () => {
    const dir = makeRepo({
      "package.json": JSON.stringify({ name: "x", scripts: { start: "a" } }),
      "a.js": 'import _ from "lodash"; _.noop();',
    });
    expect((await scan({ rootDir: dir, scannedAt: T0 })).nodes.some((n) => n.id === "lib:lodash")).toBe(false);
    expect((await scan({ rootDir: dir, scannedAt: T0, includeLibraries: true })).nodes.some((n) => n.id === "lib:lodash")).toBe(true);
  });

  it("classifies a workspace package with no runtime entry as a library", async () => {
    const dir = makeRepo({
      "package.json": JSON.stringify({ name: "mono", workspaces: ["packages/*", "apps/*"] }),
      "packages/util/package.json": JSON.stringify({ name: "@m/util" }),
      "packages/util/index.js": "export const x = 1;",
      "apps/web/package.json": JSON.stringify({ name: "@m/web", scripts: { start: "node s.js" }, dependencies: { "@m/util": "*" } }),
      "apps/web/s.js": 'import { x } from "@m/util"; console.log(x);',
    });
    const g = await scan({ rootDir: dir, scannedAt: T0 });
    expect(g.nodes.find((n) => n.id === "service:packages/util")?.type).toBe("library");
    expect(g.nodes.find((n) => n.id === "service:apps/web")?.type).toBe("service");
    expect(g.edges.find((e) => e.from === "service:apps/web" && e.to === "service:packages/util")?.confidence).toBe("high");
    expect(g.nodes.some((n) => n.id === "service:.")).toBe(false);
  });

  it("returns an empty graph for an empty directory", async () => {
    const g = await scan({ rootDir: makeRepo({ "README.md": "# hi" }), scannedAt: T0 });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe("infrastructure as code, end to end", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const repo = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-iac-test-"));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  };

  it("reads a CloudFormation template: public ALB, open security group, private database", async () => {
    const template = [
      "AWSTemplateFormatVersion: '2010-09-09'",
      "Resources:",
      "  WebSg:",
      "    Type: AWS::EC2::SecurityGroup",
      "    Properties:",
      "      SecurityGroupIngress:",
      "        - IpProtocol: tcp",
      "          FromPort: 443",
      "          ToPort: 443",
      "          CidrIp: 0.0.0.0/0",
      "  Alb:",
      "    Type: AWS::ElasticLoadBalancingV2::LoadBalancer",
      "    Properties:",
      "      Scheme: internet-facing",
      "      SecurityGroups:",
      "        - !Ref WebSg",
      "  Db:",
      "    Type: AWS::RDS::DBInstance",
      "    Properties:",
      "      Engine: postgres",
      "      PubliclyAccessible: false",
      "  Fn:",
      "    Type: AWS::Lambda::Function",
      "    Properties:",
      "      FunctionName: reporter",
      "      Environment:",
      "        Variables:",
      "          DB_HOST: !GetAtt Db.Endpoint.Address",
    ].join("\n");
    const g = await scan({ rootDir: repo({ "template.yaml": template }), scannedAt: T0 });
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("cfn:Alb")?.type).toBe("loadbalancer");
    expect(byId.get("cfn:Alb")?.public).toBe(true);
    expect(byId.get("cfn:Alb")?.exposure?.some((e) => e.cidr === "0.0.0.0/0" && e.port === 443)).toBe(true);
    expect(byId.get("cfn:Db")?.public).not.toBe(true);
    expect(byId.get("cfn:Db")?.engine).toBe("postgres");
    expect(g.edges.some((e) => e.from === "cfn:Fn" && e.to === "cfn:Db" && e.type === "database")).toBe(true);
    expect(g.edges.some((e) => e.from === "internet" && e.to === "cfn:Alb")).toBe(true);
  });

  it("flags a publicly accessible database and a public-read bucket", async () => {
    const tf = [
      'resource "aws_db_instance" "open" {',
      '  engine              = "postgres"',
      "  publicly_accessible = true",
      "}",
      'resource "aws_s3_bucket" "site" {',
      '  bucket = "site"',
      '  acl    = "public-read"',
      "}",
    ].join("\n");
    const g = await scan({ rootDir: repo({ "main.tf": tf }), scannedAt: T0 });
    expect(g.nodes.find((n) => n.id === "tf:aws_db_instance.open")?.public).toBe(true);
    expect(g.nodes.find((n) => n.id === "tf:aws_s3_bucket.site")?.public).toBe(true);
  });

  it("attaches deployment info to a code service with the same name", async () => {
    const tf = [
      'resource "aws_ecs_service" "api" {',
      '  name = "api"',
      "}",
    ].join("\n");
    const g = await scan({
      rootDir: repo({
        "services/api/package.json": JSON.stringify({ name: "api", scripts: { start: "node a.js" } }),
        "services/api/a.js": "1",
        "infra/main.tf": tf,
      }),
      scannedAt: T0,
    });
    expect(g.nodes.some((n) => n.id === "tf:aws_ecs_service.api")).toBe(false);
    expect(g.nodes.find((n) => n.id === "service:services/api")?.iac?.resourceType).toBe("aws_ecs_service");
  });
});

describe("regression: this repository", () => {
  it("shows none of the phantom edges the first scanner reported", async () => {
    const root = path.resolve(here, "..", "..", "..");
    const g: DependencyGraph = await scan({ rootDir: root, scannedAt: T0 });
    const bad = g.edges.filter((e) => /^(db|queue|storage):/.test(e.to) || (e.to.startsWith("vendor:") && !["vendor:github", "vendor:supabase"].includes(e.to)));
    expect(bad).toEqual([]);
    expect(g.nodes.find((n) => n.id === "service:packages/ui")?.type).toBe("library");
    expect(g.nodes.find((n) => n.id === "service:packages/typescript-config")?.type).toBe("library");
  });
});
