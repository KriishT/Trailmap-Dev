import { describe, expect, it } from "vitest";
import { classifyPath, isDeclaredOnlyName, isToolingConfig, makeSnippet } from "./files";
import { engineFromAdoString, engineFromConfigKey, isConfigFile, normalizeKey, parseConfig } from "./config";
import {
  ecosystemForLang, matchEnv, matchHost, matchIacResource, matchImage, matchImport, matchManifestDep, matchUri,
} from "./catalog";
import { manifestKindForFile, parseManifest } from "./manifests";
import { classifyField, findSchemaFields } from "./dataclass";
import { isComposeFile, looksLikeKubernetes, parseCompose, parseDockerfile, parseHelmChart, parseKubernetes, renderHelmTemplate } from "./deploy";
import { linkReferences, looksLikeCloudFormation, parseCloudFormation, parseTerraform } from "./iac";
import { GraphBuilder, confidenceFor, ev, type Signal } from "./assemble";

describe("files", () => {
  it("classifies tests, fixtures, docs and vendored code, but not real code", () => {
    expect(classifyPath("src/a.test.ts")).toBe("test");
    expect(classifyPath("src/__tests__/a.ts")).toBe("test");
    expect(classifyPath("pkg/foo_test.go")).toBe("test");
    expect(classifyPath("app/models/user_spec.rb")).toBe("test");
    expect(classifyPath("src/test/java/AppTest.java")).toBe("test");
    expect(classifyPath("test_things.py")).toBe("test");
    expect(classifyPath("x/fixtures/a.ts")).toBe("fixture");
    expect(classifyPath("docs/guide.ts")).toBe("doc");
    expect(classifyPath("README.md")).toBe("doc");
    expect(classifyPath("third_party/a.js")).toBe("vendored");
    expect(classifyPath("vendor/a.go")).toBe("vendored");
    expect(classifyPath("src/index.ts")).toBeUndefined();
    expect(classifyPath("requirements.txt")).toBeUndefined();
  });

  it("recognises example env files and tooling configs", () => {
    for (const n of [".env.example", ".env.sample", ".env.local.example", ".env.template"]) expect(isDeclaredOnlyName(n), n).toBe(true);
    expect(isDeclaredOnlyName(".env")).toBe(false);
    expect(isToolingConfig("apps/web/eslint.config.js")).toBe(true);
    expect(isToolingConfig("tailwind.config.ts")).toBe(true);
    expect(isToolingConfig("sentry.client.config.ts")).toBe(false);
  });

  it("masks credentials and secrets in snippets but keeps env lookups", () => {
    expect(makeSnippet('const u = "postgres://app:hunter2@db:5432/x";')).toBe('const u = "postgres://***@db:5432/x";');
    expect(makeSnippet("STRIPE_SECRET_KEY: sk_live_abcdef123456")).toBe("STRIPE_SECRET_KEY: ***");
    expect(makeSnippet('password = "hunter2"')).toBe('password = "***"');
    expect(makeSnippet("key=ghp_abcdefghij1234567890")).toBe("key=***");
    expect(makeSnippet("sg = Client(api_key=os.environ.get('SENDGRID_API_KEY'))")).toContain("os.environ.get('SENDGRID_API_KEY')");
    expect(makeSnippet("const k = process.env.STRIPE_SECRET_KEY;")).toContain("process.env.STRIPE_SECRET_KEY");
    expect(makeSnippet("   ")).toBeUndefined();
    expect(makeSnippet(undefined)).toBeUndefined();
    expect(makeSnippet("x".repeat(300))!.length).toBeLessThanOrEqual(120);
  });
});

describe("config", () => {
  it("flattens appsettings, properties, yaml and .env", () => {
    const json = parseConfig("appsettings.json", '{"ConnectionStrings":{"Default":"Host=db"},"A":{"B":1}}');
    expect(json.map((c) => [c.key, c.value])).toEqual([["ConnectionStrings:Default", "Host=db"], ["A:B", "1"]]);
    const props = parseConfig("application.properties", "# c\nspring.datasource.url=jdbc:postgresql://db/app\nserver.port = 8081");
    expect(props.map((c) => c.key)).toEqual(["spring.datasource.url", "server.port"]);
    const yml = parseConfig("application.yml", "spring:\n  redis:\n    host: cache\n");
    expect(yml[0]).toMatchObject({ key: "spring.redis.host", value: "cache" });
    const env = parseConfig(".env", 'A=1\nexport B="two"\n# c\n');
    expect(env.map((c) => [c.key, c.value])).toEqual([["A", "1"], ["B", "two"]]);
    expect(parseConfig("appsettings.json", "{not json")).toEqual([]);
  });

  it("knows which files are config and normalises keys", () => {
    expect(isConfigFile("src/appsettings.Production.json")).toBe(true);
    expect(isConfigFile("config/database.yml")).toBe(true);
    expect(isConfigFile("src/index.ts")).toBe(false);
    expect(normalizeKey("Services:Payments__Url")).toBe(normalizeKey("services.payments.url"));
  });

  it("infers engines from keys and ADO strings", () => {
    expect(engineFromConfigKey("default.adapter", "postgresql")).toBe("postgres");
    expect(engineFromConfigKey("x.adapter", "mysql2")).toBe("mysql");
    expect(engineFromConfigKey("spring.kafka.bootstrap-servers", "k:9092")).toBe("kafka");
    expect(engineFromConfigKey("spring.data.redis.host", "r")).toBe("redis");
    expect(engineFromConfigKey("unrelated", "x")).toBeNull();
    expect(engineFromAdoString("Host=db;Username=u;Password=p;Database=a")).toBe("postgres");
    expect(engineFromAdoString("Server=db;Database=a;User Id=u;")).toBe("mssql");
    expect(engineFromAdoString("just text")).toBeNull();
  });
});

describe("catalog", () => {
  it("matches imports per ecosystem with the longest prefix", () => {
    expect(matchImport("js", "stripe")?.id).toBe("stripe");
    expect(matchImport("js", "@aws-sdk/client-s3")?.id).toBe("s3");
    expect(matchImport("js", "pg/lib/x")?.id).toBe("postgres");
    expect(matchImport("py", "psycopg2.extras")?.id).toBe("postgres");
    expect(matchImport("py", "google.cloud.storage")?.id).toBe("gcs");
    expect(matchImport("go", "github.com/segmentio/kafka-go")?.id).toBe("kafka");
    expect(matchImport("java", "org.postgresql.Driver")?.id).toBe("postgres");
    expect(matchImport("cs", "Npgsql.EntityFrameworkCore")?.id).toBe("postgres");
    expect(matchImport("rb", "twilio-ruby")?.id).toBe("twilio");
    expect(matchImport("js", "left-pad")).toBeNull();
    expect(ecosystemForLang("rb")).toBe("ruby");
  });

  it("matches hosts, env vars, URIs, images and IaC resources", () => {
    expect(matchHost("api.stripe.com")?.id).toBe("stripe");
    expect(matchHost("eu.api.stripe.com")?.id).toBe("stripe");
    expect(matchHost("notstripe.com")).toBeNull();
    expect(matchEnv("SENDGRID_API_KEY")?.id).toBe("sendgrid");
    expect(matchEnv("PATH")).toBeNull();
    expect(matchUri("postgres://u:p@h/db")?.id).toBe("postgres");
    expect(matchUri("jdbc:postgresql://h/db")?.id).toBe("postgres");
    expect(matchUri("https://example.com")).toBeNull();
    expect(matchImage("postgres:15-alpine")?.id).toBe("postgres");
    expect(matchImage("bitnami/redis:7")?.id).toBe("redis");
    expect(matchImage("ghcr.io/acme/api:1")).toBeNull();
    expect(matchIacResource("tf", "aws_db_instance", "postgres")?.id).toBe("postgres");
    expect(matchIacResource("tf", "aws_db_instance", "mysql")?.id).toBe("mysql");
    expect(matchIacResource("tf", "aws_s3_bucket")?.id).toBe("s3");
    expect(matchIacResource("cfn", "AWS::SQS::Queue")?.id).toBe("sqs");
    expect(matchManifestDep("npm", "Stripe")?.id).toBe("stripe");
    expect(matchManifestDep("pypi", "nope")).toBeNull();
  });
});

describe("manifests", () => {
  it("parses package.json with workspaces, scripts, frameworks and dev deps", () => {
    const m = parseManifest(
      "web/package.json",
      JSON.stringify({ name: "@a/web", scripts: { start: "next start" }, dependencies: { next: "1", react: "1", "@prisma/client": "1" }, devDependencies: { typescript: "5", vitest: "1" }, bin: { x: "y" } }),
      { hasTsconfig: false }
    )!;
    expect(m.language).toBe("typescript");
    expect(m.frameworks).toContain("nextjs");
    expect(m.techStack).toContain("prisma");
    expect(m.deps.find((d) => d.name === "vitest")?.dev).toBe(true);
    expect(m.hasBin).toBe(true);
    expect(parseManifest("package.json", "{oops", {})).toBeNull();
    const ws = parseManifest("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }), {})!;
    expect(ws.aggregator).toBe(true);
  });

  it("parses python, go, maven, gradle, ruby and dotnet manifests", () => {
    expect(parseManifest("requirements.txt", "fastapi==1\n# c\nsqlalchemy>=2\n-r other.txt\n", {})!.frameworks).toContain("fastapi");
    expect(parseManifest("pyproject.toml", 'name = "x"\ndependencies = [\n  "django>=4",\n  "psycopg2",\n]\n', {})!.deps.map((d) => d.name)).toEqual(["django", "psycopg2"]);
    const go = parseManifest("go.mod", "module ex.com/a\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0 // x\n)\nrequire github.com/lib/pq v1.0.0\n", {})!;
    expect(go.name).toBe("ex.com/a");
    expect(go.frameworks).toContain("gin");
    expect(go.deps.map((d) => d.name)).toContain("github.com/lib/pq");
    const pom = parseManifest("pom.xml", '<project><artifactId>a</artifactId><packaging>pom</packaging><dependencies><dependency><groupId>g</groupId><artifactId>spring-boot-starter-web</artifactId></dependency><dependency><groupId>junit</groupId><artifactId>junit</artifactId><scope>test</scope></dependency></dependencies></project>', {})!;
    expect(pom.aggregator).toBe(true);
    expect(pom.frameworks).toContain("spring");
    expect(pom.deps.find((d) => d.name === "junit:junit")?.dev).toBe(true);
    const gradle = parseManifest("build.gradle", "plugins { id 'org.springframework.boot' }\nimplementation 'org.postgresql:postgresql:42'\ntestImplementation 'junit:junit:4'", {})!;
    expect(gradle.deps.map((d) => [d.name, d.dev])).toEqual([["org.postgresql:postgresql", false], ["junit:junit", true]]);
    expect(parseManifest("Gemfile", 'gem "rails"\ngem "pg"\n', {})!.frameworks).toContain("rails");
    const cs = parseManifest("Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Npgsql" Version="1" /></ItemGroup></Project>', {})!;
    expect(cs.webApp).toBe(true);
    expect(cs.language).toBe("csharp");
    expect(manifestKindForFile("a/b/Foo.csproj")).toBe("csproj");
    expect(manifestKindForFile("requirements-dev.txt")).toBe("requirements");
    expect(manifestKindForFile("index.ts")).toBeNull();
  });
});

describe("data classification", () => {
  it("classifies field names", () => {
    expect(classifyField("email")).toBe("PII");
    expect(classifyField("billingAddress")).toBe("PII");
    expect(classifyField("card_number")).toBe("PAN");
    expect(classifyField("cvv")).toBe("PAN");
    expect(classifyField("password_hash")).toBe("CREDENTIALS");
    expect(classifyField("api_key")).toBe("CREDENTIALS");
    expect(classifyField("diagnosis_code")).toBe("PHI");
    expect(classifyField("created_at")).toBeNull();
    expect(classifyField("contact", "EmailField")).toBe("PII");
    expect(classifyField("")).toBeNull();
  });

  it("extracts fields from Prisma, SQL, Rails, TypeORM, Django, Go and OpenAPI", () => {
    const names = (rel: string, src: string) => findSchemaFields(rel, src).map((f) => `${f.entity}.${f.field}`);
    expect(names("schema.prisma", 'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id Int @id\n  email String\n  @@index([email])\n}\n')).toEqual(["User.id", "User.email"]);
    expect(findSchemaFields("schema.prisma", 'datasource db {\n  provider = "mysql"\n}\nmodel A {\n  x Int\n}')[0]!.engine).toBe("mysql");
    expect(names("db/001.sql", "-- c\nCREATE TABLE users (\n  id int,\n  email text,\n  PRIMARY KEY (id)\n);\nALTER TABLE users ADD COLUMN phone text;")).toEqual(["users.id", "users.email", "users.phone"]);
    expect(names("db/schema.rb", 'create_table "users" do |t|\n  t.string "email"\nend')).toEqual(["users.email"]);
    expect(names("user.entity.ts", "@Entity()\nexport class User {\n  @Column()\n  email: string;\n}\n")).toEqual(["User.email"]);
    expect(names("models.py", "from django.db import models\nclass P(models.Model):\n    contact = models.EmailField()\n")).toEqual(["P.contact"]);
    expect(names("user.go", 'type User struct {\n  Email string `db:"email"`\n}\n')).toEqual(["User.email"]);
    expect(names("openapi.yaml", "components:\n  schemas:\n    Customer:\n      type: object\n      properties:\n        email:\n          type: string\n")).toEqual(["Customer.email"]);
    expect(findSchemaFields("src/index.ts", "const a = 1;")).toEqual([]);
  });
});

describe("deploy descriptors", () => {
  it("parses compose services, build.dockerfile, env lists and depends_on", () => {
    expect(isComposeFile("deploy/docker-compose.prod.yml")).toBe(true);
    const units = parseCompose(
      "docker-compose.yml",
      "services:\n  api:\n    build:\n      context: .\n      dockerfile: apps/api/Dockerfile\n    environment:\n      - A=1\n      - B\n    depends_on: [db]\n    ports: ['8080:80', 9000]\n  db:\n    image: postgres:15\n"
    );
    const api = units.find((u) => u.name === "api")!;
    expect(api.buildContext).toBe("apps/api");
    expect(api.env.map((e) => [e.name, e.value])).toEqual([["A", "1"], ["B", undefined]]);
    expect(api.dependsOn).toEqual(["db"]);
    expect(api.ports).toEqual([80, 9000]);
    expect(units.find((u) => u.name === "db")?.image).toBe("postgres:15");
    expect(parseCompose("c.yml", "::: not yaml :::\n\t")).toEqual([]);
  });

  it("parses Dockerfile EXPOSE and ENV", () => {
    expect(parseDockerfile("FROM x\nEXPOSE 3000 9090\nENV NODE_ENV=production\nCMD node --port 4000")).toMatchObject({
      ports: [3000, 9090, 4000],
      env: [{ name: "NODE_ENV", value: "production" }],
    });
  });

  it("parses Kubernetes workloads, services and ingress exposure", () => {
    const yml = [
      "apiVersion: apps/v1", "kind: Deployment", "metadata:", "  name: web", "spec:", "  template:", "    metadata:", "      labels:", "        app: web",
      "    spec:", "      containers:", "        - name: web", "          image: ghcr.io/a/web:1", "          env:", "            - name: X", "              value: y",
      "---", "apiVersion: v1", "kind: Service", "metadata:", "  name: web-svc", "spec:", "  type: LoadBalancer", "  selector:", "    app: web",
    ].join("\n");
    expect(looksLikeKubernetes(yml)).toBe(true);
    const [u] = parseKubernetes("k.yaml", yml);
    expect(u).toMatchObject({ name: "web", image: "ghcr.io/a/web:1", public: true });
    expect(u!.aliases).toContain("web-svc");
    expect(u!.env).toEqual([expect.objectContaining({ name: "X", value: "y" })]);
  });

  it("renders Helm templates well enough to read values", () => {
    const out = renderHelmTemplate(
      'name: {{ .Release.Name }}\nimage: "{{ .Values.image.repo }}:{{ .Values.tag }}"\n{{- if .Values.on }}\nx: {{ .Values.missing | quote }}\n{{- end }}\n',
      { name: "app", values: { image: { repo: "r" }, tag: "1" } }
    );
    expect(out).toContain("name: app");
    expect(out).toContain('image: "r:1"');
    expect(out).not.toContain("{{");
    const units = parseHelmChart({
      dir: "c", name: "app", values: { url: "http://api:80" },
      templates: [{ file: "c/templates/d.yaml", content: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\nspec:\n  template:\n    spec:\n      containers:\n        - name: a\n          image: x\n          env:\n            - name: U\n              value: {{ .Values.url }}\n" }],
    });
    expect(units[0]?.env[0]).toMatchObject({ name: "U", value: "http://api:80" });
  });
});

describe("infrastructure as code", () => {
  it("parses Terraform resources and links references", async () => {
    const tf = [
      'resource "aws_security_group" "web" {', '  name = "web"', "}", "",
      'resource "aws_lb" "front" {', "  security_groups = [aws_security_group.web.id]", "}", "",
    ].join("\n");
    const rs = await parseTerraform("main.tf", tf);
    linkReferences(rs);
    expect(rs.map((r) => r.address).sort()).toEqual(["aws_lb.front", "aws_security_group.web"]);
    expect(rs.find((r) => r.address === "aws_lb.front")!.refs).toEqual(["aws_security_group.web"]);
    expect(rs.find((r) => r.address === "aws_lb.front")!.line).toBe(5);
    expect(await parseTerraform("bad.tf", "resource {{{")).toEqual([]);
  });

  it("parses CloudFormation with intrinsic function tags", () => {
    const yml = [
      "AWSTemplateFormatVersion: '2010-09-09'", "Resources:", "  Db:", "    Type: AWS::RDS::DBInstance", "    Properties:", "      Engine: postgres",
      "  Fn:", "    Type: AWS::Lambda::Function", "    Properties:", "      Environment:", "        Variables:", "          HOST: !GetAtt Db.Endpoint.Address", "          NAME: !Ref Db",
    ].join("\n");
    expect(looksLikeCloudFormation(yml)).toBe(true);
    const rs = parseCloudFormation("t.yaml", yml);
    linkReferences(rs);
    expect(rs.map((r) => r.type)).toEqual(["AWS::RDS::DBInstance", "AWS::Lambda::Function"]);
    expect(rs[1]!.refs).toEqual(["Db"]);
    expect(parseCloudFormation("t.json", "{bad")).toEqual([]);
  });
});

describe("assembly", () => {
  it("derives confidence from independent signals", () => {
    const c = (...s: Signal[]) => confidenceFor(new Set(s));
    expect(c("sdk-import", "env-read")).toBe("high");
    expect(c("sdk-import")).toBe("medium");
    expect(c("http-call")).toBe("high");
    expect(c("connstring")).toBe("high");
    expect(c("iac")).toBe("medium");
    expect(c("dependency")).toBe("low");
    expect(c("declared")).toBeNull();
    expect(c("declared", "dependency")).toBe("low");
  });

  it("merges nodes, rewires edges and drops edges whose endpoints vanished", () => {
    const b = new GraphBuilder();
    const node = (id: string) => ({ id, name: id, type: "service" as const, language: "unknown" as const, port: null, endpoints: [], path: "", evidence: [] });
    b.addNode(node("a")); b.addNode(node("old")); b.addNode(node("new"));
    b.addEdge("a", "old", "http", "http-call", [ev("http-call", "f", "x", 1)]);
    b.addEdge("a", "new", "http", "sdk-import", [ev("sdk-import", "g", "y", 2)]);
    b.mergeNodeInto("old", "new");
    b.addEdge("a", "ghost", "http", "http-call", []);
    const g = b.build({ repo: "r", scannedAt: "t", languageBreakdown: {}, totalFiles: 0 });
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "new"]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.confidence).toBe("high");
    expect(g.edges[0]!.evidence).toHaveLength(2);
  });
});
