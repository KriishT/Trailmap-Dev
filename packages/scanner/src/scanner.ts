import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { DataClass, DependencyGraph, GraphEvidence, GraphNode, Language } from "@trailmap/graph";
import type { ScanOptions } from "./types.js";
import { walk, makeSnippet, isToolingConfig, type FileInfo } from "./files.js";
import { tokenize, langForFile, type Lang } from "./tokenize.js";
import {
  extractSignals, dropUnusedImports, maskDeadBlocks,
  type Signal as CodeSignal, type ImportSignal,
} from "./extract.js";
import {
  matchImport, matchManifestDep, matchHost, matchEnv, matchUri, matchImage, getVendor, getEngine, VENDORS,
  type Entity, type ManifestEcosystem, type Engine,
} from "./catalog.js";
import { parseManifest, manifestKindForFile, SERVER_FRAMEWORKS, type Manifest } from "./manifests.js";
import { isConfigFile, parseConfig, normalizeKey, engineFromConfigKey, engineFromAdoString, type ConfigValue } from "./config.js";
import {
  isComposeFile, parseCompose, parseDockerfile, looksLikeKubernetes, parseKubernetes, parseHelmChart,
  type DeployUnit, type HelmChart,
} from "./deploy.js";
import { parseTerraform, parseCloudFormation, looksLikeCloudFormation, linkReferences, type IacResource } from "./iac.js";
import { mapIac, INTERNET_ID } from "./iac-map.js";
import { findSchemaFields, classifyField, type SchemaField } from "./dataclass.js";
import { GraphBuilder, ev, type Signal } from "./assemble.js";

const SOURCE_LANGS: Lang[] = ["js", "py", "go", "java", "cs", "rb"];
const MANIFEST_PRIORITY = ["package.json", "go.mod", "pom.xml", "gradle", "csproj", "pyproject", "requirements", "Gemfile"];

interface Root {
  rel: string;
  id: string;
  name: string;
  manifests: Manifest[];
  files: FileInfo[];
  dockerfile?: { rel: string; ports: number[]; env: Array<{ name: string; value?: string; line?: number }> };
  listens: Array<{ file: string; line: number; port?: number }>;
  ports: number[];
  config: ConfigValue[];
  declared: Array<{ name: string; file: string; line: number }>;
  envReads: Array<{ name: string; file: string; line: number }>;
  fileVendors: Map<string, Set<string>>;
  units: DeployUnit[];
  aliases: Set<string>;
  language: Language;
  isRuntime: boolean;
  public: boolean;
}

type CallSig = Extract<CodeSignal, { k: "call" }>;
type HttpSig = Extract<CodeSignal, { k: "http" }>;
type UriSig = Extract<CodeSignal, { k: "uri" }>;
type BotoSig = Extract<CodeSignal, { k: "boto" }>;

const EXT_LANG: Record<string, Language> = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".java": "java", ".kt": "java", ".cs": "csharp", ".rb": "ruby", ".rake": "ruby",
};

function aliasVariants(raw: string): string[] {
  const lower = raw.toLowerCase().replace(/^@[^/]+\//, "");
  const stripped = lower.replace(/[-_](service|svc|api|server|app)$/, "");
  return stripped && stripped !== lower ? [lower, stripped] : [lower];
}

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const RESERVED_HOST = /(^|\.)(example\.(com|org|net)|localhost|test|invalid|example|local)$/i;

function parseUrl(value: string): { host: string; port?: number; path: string } | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([A-Za-z0-9._-]+)(?::(\d{2,5}))?(\/[^\s]*)?/.exec(value.trim());
  if (!m || !m[1]) return null;
  return { host: m[1].toLowerCase(), port: m[2] ? Number.parseInt(m[2], 10) : undefined, path: m[3] ?? "" };
}

const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const baseOf = (rel: string) => rel.split("/").pop() ?? rel;

export async function scan(options: ScanOptions): Promise<DependencyGraph> {
  const { rootDir, exclude = [], includeLibraries = false, repoName, includeTests = false } = options;
  const absRoot = path.resolve(rootDir);
  const repo = repoName ?? path.basename(absRoot);
  const repoShort = repo.split("/").pop() ?? repo;
  const scannedAt = options.scannedAt ?? new Date().toISOString();

  const { files: walked } = await walk(absRoot, { exclude, maxFileBytes: options.maxFileBytes });
  const active = walked.filter((f) => !f.ignored || (includeTests && f.ignored === "test"));

  const textCache = new Map<string, string>();
  const read = (f: FileInfo): string => {
    let t = textCache.get(f.rel);
    if (t === undefined) {
      try { t = fs.readFileSync(f.abs, "utf8"); } catch { t = ""; }
      textCache.set(f.rel, t);
    }
    return t;
  };
  // Read everything up front, in parallel: on slow or virus-scanned file systems the serial
  // cost of thousands of small reads dominates the whole scan.
  {
    let next = 0;
    await Promise.all(
      Array.from({ length: 64 }, async () => {
        while (next < active.length) {
          const f = active[next++]!;
          try {
            textCache.set(f.rel, await fs.promises.readFile(f.abs, "utf8"));
          } catch {
            textCache.set(f.rel, "");
          }
        }
      })
    );
  }
  const lineCache = new Map<string, string[]>();
  const lineText = (rel: string, line: number): string | undefined => {
    let ls = lineCache.get(rel);
    if (!ls) { ls = (textCache.get(rel) ?? "").split("\n"); lineCache.set(rel, ls); }
    return ls[line - 1];
  };
  const evAt = (kind: GraphEvidence["kind"], file: string, line: number | undefined, detail: string): GraphEvidence =>
    ev(kind, file, detail, line, line ? makeSnippet(lineText(file, line)) : undefined);

  const builder = new GraphBuilder();

  // ---------------------------------------------------------------- 1. manifests and roots
  const tsconfigDirs = new Set(active.filter((f) => baseOf(f.rel) === "tsconfig.json").map((f) => dirOf(f.rel)));

  const manifestsByDir = new Map<string, Manifest[]>();
  for (const f of active) {
    if (!manifestKindForFile(f.rel)) continue;
    const m = parseManifest(f.rel, read(f), { hasTsconfig: tsconfigDirs.has(dirOf(f.rel)) });
    if (!m) continue;
    const list = manifestsByDir.get(dirOf(f.rel)) ?? [];
    list.push(m);
    manifestsByDir.set(dirOf(f.rel), list);
  }
  const rank = (m: Manifest) => { const i = MANIFEST_PRIORITY.indexOf(m.kind); return i === -1 ? 99 : i; };
  for (const list of manifestsByDir.values()) list.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));

  const sourceFiles = active.filter((f) => langForFile(f.rel));
  const rootDirs = new Set<string>();
  for (const [dir, list] of manifestsByDir) {
    if (list.some((m) => !m.aggregator)) rootDirs.add(dir);
  }
  const underAnyRoot = (dir: string) => [...rootDirs].some((r) => r === "" || dir === r || dir.startsWith(r + "/"));
  const dockerfiles = active.filter((f) => /^Dockerfile(\..+)?$|\.Dockerfile$/.test(baseOf(f.rel)));
  for (const d of dockerfiles) {
    const dir = dirOf(d.rel);
    if (!underAnyRoot(dir)) rootDirs.add(dir);
  }

  // compose build contexts add roots for source directories that have no manifest
  const composeUnitsAll: DeployUnit[] = [];
  for (const f of active) if (isComposeFile(f.rel)) composeUnitsAll.push(...parseCompose(f.rel, read(f)));
  for (const u of composeUnitsAll) {
    const ctx = u.buildContext;
    if (ctx !== undefined && !underAnyRoot(ctx) && sourceFiles.some((s) => ctx === "" || s.rel.startsWith(ctx + "/"))) {
      rootDirs.add(ctx);
    }
  }
  if (rootDirs.size === 0 && sourceFiles.length > 0) rootDirs.add("");

  let sortedDirs = [...rootDirs].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const deepestRoot = (rel: string): string | null => {
    for (const d of sortedDirs) if (d === "" || rel === d || rel.startsWith(d + "/")) return d;
    return null;
  };
  // A root that contains other roots only stays if it owns source files of its own.
  for (const d of [...rootDirs]) {
    const hasChild = [...rootDirs].some((o) => o !== d && (d === "" || o.startsWith(d + "/")));
    if (!hasChild) continue;
    const own = sourceFiles.filter((s) => deepestRoot(s.rel) === d).length;
    if (own === 0) rootDirs.delete(d);
  }
  sortedDirs = [...rootDirs].sort((a, b) => b.length - a.length || a.localeCompare(b));

  const roots = new Map<string, Root>();
  for (const dir of [...rootDirs].sort()) {
    const manifests = manifestsByDir.get(dir) ?? [];
    roots.set(dir, {
      rel: dir, id: `service:${dir || "."}`, name: dir === "" ? repoShort : baseOf(dir),
      manifests: manifests.filter((m) => !m.aggregator),
      files: [], listens: [], ports: [], config: [], declared: [], envReads: [], fileVendors: new Map(),
      units: [], aliases: new Set(), language: "unknown", isRuntime: false, public: false,
    });
  }
  for (const f of active) {
    const d = deepestRoot(f.rel);
    if (d !== null && roots.has(d)) roots.get(d)!.files.push(f);
  }
  const rootList = [...roots.values()].sort((a, b) => a.rel.localeCompare(b.rel));
  const rootOfFile = (rel: string): Root | null => {
    const d = deepestRoot(rel);
    return d === null ? null : (roots.get(d) ?? null);
  };

  // ---------------------------------------------------------------- 2. aliases
  const aliasMap = new Map<string, string>();
  const registerAlias = (alias: string | undefined, id: string) => {
    if (!alias) return;
    for (const v of aliasVariants(alias)) if (v && !aliasMap.has(v)) aliasMap.set(v, id);
  };
  const manifestNames = new Map<string, Root>();
  const goModules = new Map<string, Root>();
  for (const r of rootList) {
    registerAlias(r.name, r.id);
    r.aliases.add(r.name.toLowerCase());
    for (const m of r.manifests) {
      if (!m.name) continue;
      registerAlias(m.name, r.id);
      r.aliases.add(m.name.toLowerCase());
      if (m.kind === "package.json") manifestNames.set(m.name, r);
      if (m.kind === "go.mod") goModules.set(m.name, r);
    }
  }

  // ---------------------------------------------------------------- 3. deploy descriptors
  const units: DeployUnit[] = [...composeUnitsAll];
  const helmCharts = new Map<string, HelmChart>();
  const chartDirs = active.filter((f) => baseOf(f.rel) === "Chart.yaml").map((f) => dirOf(f.rel));
  const inChart = (rel: string) => chartDirs.find((d) => rel.startsWith((d ? d + "/" : "") + "templates/"));
  for (const f of active) {
    if (baseOf(f.rel) !== "Chart.yaml") continue;
    let name = baseOf(dirOf(f.rel)) || "chart";
    let values: unknown = {};
    try { name = (yaml.load(read(f)) as { name?: string } | null)?.name ?? name; } catch { /* ignore */ }
    const vf = active.find((x) => x.rel === (dirOf(f.rel) ? dirOf(f.rel) + "/" : "") + "values.yaml");
    if (vf) { try { values = yaml.load(read(vf)); } catch { /* ignore */ } }
    helmCharts.set(dirOf(f.rel), { dir: dirOf(f.rel), name, values, templates: [] });
  }
  for (const f of active) {
    const cd = inChart(f.rel);
    if (cd !== undefined && f.ext === ".yaml") helmCharts.get(cd)?.templates.push({ file: f.rel, content: read(f) });
    else if (cd !== undefined && f.ext === ".yml") helmCharts.get(cd)?.templates.push({ file: f.rel, content: read(f) });
  }
  for (const chart of helmCharts.values()) units.push(...parseHelmChart(chart));

  const iacResources: IacResource[] = [];
  for (const f of active) {
    if (f.ext === ".tf") {
      iacResources.push(...(await parseTerraform(f.rel, read(f))));
    } else if (/\.(ya?ml|json)$/.test(f.ext) && !isComposeFile(f.rel) && inChart(f.rel) === undefined && !isConfigFile(f.rel) && !manifestKindForFile(f.rel) && !baseOf(f.rel).startsWith("tsconfig") && f.size < 512 * 1024) {
      const text = read(f);
      if (looksLikeCloudFormation(text)) iacResources.push(...parseCloudFormation(f.rel, text));
      else if (/\.ya?ml$/.test(f.ext) && looksLikeKubernetes(text)) units.push(...parseKubernetes(f.rel, text));
    }
  }
  linkReferences(iacResources);

  // attribute deploy units to code roots
  const unattributed: DeployUnit[] = [];
  const unitNodeId = new Map<DeployUnit, string>();
  for (const u of units) {
    let hit: Root | undefined;
    const ctx = u.buildContext;
    if (ctx !== undefined) {
      hit = rootList.find((r) => r.rel === ctx) ?? rootList.find((r) => r.rel !== "" && ctx.startsWith(r.rel + "/"));
    }
    if (!hit) {
      const names = [u.name, ...u.aliases].flatMap(aliasVariants);
      hit = rootList.find((r) => [...r.aliases].flatMap(aliasVariants).some((a) => names.includes(a)));
    }
    if (!hit && u.image && !matchImage(u.image)) {
      const imgName = ((u.image.split(":")[0] ?? "").split("/").pop() ?? "").toLowerCase();
      hit = rootList.find((r) => [...r.aliases].flatMap(aliasVariants).includes(imgName));
    }
    if (hit) {
      unitNodeId.set(u, hit.id);
      hit.units.push(u);
      for (const a of [u.name, ...u.aliases]) { registerAlias(a, hit.id); hit.aliases.add(a.toLowerCase()); }
      hit.ports.push(...u.ports);
      if (u.public) hit.public = true;
    } else unattributed.push(u);
  }

  const entityPrefix = (e: Engine) => (e.nodeType === "database" ? "db" : e.nodeType);
  const entityNodeId = (entity: Entity) =>
    entity.kind === "vendor" ? `vendor:${entity.id}` : `${entityPrefix(entity.engine)}:${entity.id}`;
  const ensureEntity = (entity: Entity): string => {
    const id = entityNodeId(entity);
    if (entity.kind === "vendor") {
      builder.addNode({ id, name: entity.vendor.name, type: "saas", language: "unknown", port: null, endpoints: [], path: "", vendor: entity.id, evidence: [] });
    } else {
      builder.addNode({ id, name: entity.engine.name, type: entity.engine.nodeType, language: "unknown", port: null, endpoints: [], path: "", engine: entity.id, evidence: [] });
    }
    return id;
  };
  const edgeTypeFor = (entity: Entity) => (entity.kind === "engine" ? entity.engine.edge : ("http" as const));
  const linkEntity = (from: string, entity: Entity, signal: Signal, evidence: GraphEvidence[]): string => {
    const to = ensureEntity(entity);
    builder.addEdge(from, to, edgeTypeFor(entity), signal, evidence);
    if (entity.kind === "engine" && entity.engine.vendor) {
      const v = getVendor(entity.engine.vendor);
      if (v) builder.addEdge(from, ensureEntity({ kind: "vendor", id: v.id, vendor: v }), "http", signal, evidence);
    }
    return to;
  };

  // Compose / k8s infrastructure that is not one of our code services
  for (const u of unattributed) {
    const engine = u.image ? matchImage(u.image) : null;
    const kind = (u.kind === "compose" ? "compose" : u.kind === "helm" ? "helm" : "kubernetes") as GraphEvidence["kind"];
    const evd = [evAt(kind, u.file, u.line, `${u.kind} service "${u.name}"${u.image ? ` (image ${u.image})` : ""}`)];
    if (engine) {
      const id = ensureEntity({ kind: "engine", id: engine.id, engine });
      const n = builder.nodes.get(id)!;
      n.evidence = [...(n.evidence ?? []), ...evd];
      for (const a of [u.name, ...u.aliases]) registerAlias(a, id);
      continue;
    }
    if (!u.image && u.buildContext === undefined) continue;
    const id = `deploy:${u.name}`;
    const node: GraphNode = {
      id, name: u.name, type: "service", language: "unknown", port: u.ports[0] ?? null, endpoints: [],
      path: dirOf(u.file) || ".", evidence: evd,
    };
    if (u.public) {
      node.public = true;
      node.exposure = [{ direction: "ingress", cidr: "0.0.0.0/0", port: u.ports[0] ?? null, source: u.file, line: u.line }];
    }
    builder.addNode(node);
    for (const a of [u.name, ...u.aliases]) registerAlias(a, id);
    unitNodeId.set(u, id);
  }

  // ---------------------------------------------------------------- 4. read source and config files
  const languageCounts: Record<string, number> = {};
  const schemaFieldsByRoot = new Map<Root, SchemaField[]>();
  const callsByRoot = new Map<Root, Array<{ file: string; sig: CallSig }>>();
  const httpByRoot = new Map<Root, Array<{ file: string; sig: HttpSig }>>();
  const uriByRoot = new Map<Root, Array<{ file: string; sig: UriSig }>>();
  const botoByRoot = new Map<Root, Array<{ file: string; sig: BotoSig }>>();
  const importsByRoot = new Map<Root, Array<{ file: string; lang: Lang; sig: ImportSignal }>>();
  const rubyConstHits = new Map<Root, Array<{ file: string; line: number; vendor: string; constant: string }>>();
  const openApiEndpoints = new Map<Root, string[]>();
  const constantToVendor = new Map<string, string>();
  for (const v of VENDORS) for (const c of v.constants) constantToVendor.set(c, v.id);
  const push = <T>(map: Map<Root, T[]>, root: Root, item: T) => {
    const list = map.get(root);
    if (list) list.push(item);
    else map.set(root, [item]);
  };

  let totalFiles = 0;
  for (const f of active) {
    totalFiles++;
    const root = rootOfFile(f.rel);
    const lang = langForFile(f.rel);
    if (lang) {
      const key = EXT_LANG[f.ext] ?? "unknown";
      languageCounts[key] = (languageCounts[key] ?? 0) + 1;
    }
    if (!root) continue;
    const text = read(f);

    if (lang && SOURCE_LANGS.includes(lang) && !isToolingConfig(f.rel)) {
      const tokens = maskDeadBlocks(tokenize(text, lang), lang);
      const signals = dropUnusedImports(extractSignals(tokens, lang), tokens);
      const vendorsHere = new Set<string>();
      root.fileVendors.set(f.rel, vendorsHere);
      for (const s of signals) {
        switch (s.k) {
          case "import": push(importsByRoot, root, { file: f.rel, lang, sig: s }); break;
          case "env": root.envReads.push({ name: s.name, file: f.rel, line: s.line }); break;
          case "listen":
            root.listens.push({ file: f.rel, line: s.line, port: s.port });
            if (s.port) root.ports.push(s.port);
            break;
          case "call": push(callsByRoot, root, { file: f.rel, sig: s }); break;
          case "http": push(httpByRoot, root, { file: f.rel, sig: s }); break;
          case "uri": push(uriByRoot, root, { file: f.rel, sig: s }); break;
          case "boto": push(botoByRoot, root, { file: f.rel, sig: s }); break;
        }
      }
      if (lang === "rb") {
        for (let i = 0; i < tokens.length - 1; i++) {
          const t = tokens[i]!;
          const vendor = t.t === "id" ? constantToVendor.get(t.v) : undefined;
          if (vendor && tokens[i + 1]!.v === "::") {
            push(rubyConstHits, root, { file: f.rel, line: t.line, vendor, constant: t.v });
            vendorsHere.add(vendor);
          }
        }
      }
    }

    const fields = findSchemaFields(f.rel, text);
    if (fields.length) schemaFieldsByRoot.set(root, [...(schemaFieldsByRoot.get(root) ?? []), ...fields]);

    if (/(^|\/)(openapi|swagger)\.(ya?ml|json)$/i.test(f.rel)) {
      try {
        const doc = (f.ext === ".json" ? JSON.parse(text) : yaml.load(text)) as { paths?: Record<string, Record<string, unknown>> } | null;
        const eps: string[] = [];
        for (const [p, methods] of Object.entries(doc?.paths ?? {})) {
          for (const m of Object.keys(methods ?? {})) {
            if (["get", "post", "put", "patch", "delete", "head", "options"].includes(m)) eps.push(`${m.toUpperCase()} ${p}`);
          }
        }
        openApiEndpoints.set(root, [...(openApiEndpoints.get(root) ?? []), ...eps]);
      } catch { /* malformed spec */ }
    }

    if (f.declaredOnly) {
      for (const c of parseConfig(".env", text)) root.declared.push({ name: c.key, file: f.rel, line: c.line });
    } else if (isConfigFile(f.rel)) {
      root.config.push(...parseConfig(f.rel, text));
    }

    if (/^Dockerfile(\..+)?$|\.Dockerfile$/.test(baseOf(f.rel)) && dirOf(f.rel) === root.rel) {
      const info = parseDockerfile(text);
      root.dockerfile = { rel: f.rel, ports: info.ports, env: info.env };
      root.ports.push(...info.ports);
    }
  }

  // ---------------------------------------------------------------- 5. service nodes
  const portIndex = new Map<number, string[]>();
  for (const r of rootList) {
    for (const m of r.manifests) {
      for (const script of Object.values(m.scripts)) {
        const pm = /(?:PORT=|--port[= ]|-p )(\d{4,5})/.exec(script);
        if (pm) r.ports.push(Number.parseInt(pm[1]!, 10));
      }
    }
    for (const c of r.config) {
      if (/^server[.:]port$/i.test(c.key) && /^\d+$/.test(c.value)) r.ports.push(Number.parseInt(c.value, 10));
    }
    const primary = r.manifests[0];
    const fw = r.manifests.flatMap((m) => m.frameworks).find((x) => SERVER_FRAMEWORKS.has(x)) ?? r.manifests.flatMap((m) => m.frameworks)[0];
    const hasStart = r.manifests.some((m) => "start" in m.scripts || "serve" in m.scripts);
    const serverFw = r.manifests.some((m) => m.frameworks.some((x) => ["rails", "sinatra", "django", "aspnet", "spring", "micronaut", "quarkus"].includes(x)));
    r.isRuntime = Boolean(r.dockerfile) || hasStart || r.listens.length > 0 || r.units.length > 0 || r.manifests.some((m) => m.webApp) || serverFw;
    const langCounts = new Map<Language, number>();
    for (const f of r.files) { const l = EXT_LANG[f.ext]; if (l) langCounts.set(l, (langCounts.get(l) ?? 0) + 1); }
    r.language = primary?.language ?? ([...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown");
    if (r.language === "javascript" && langCounts.get("typescript")) r.language = "typescript";

    const evidence: GraphEvidence[] = [];
    for (const m of r.manifests) evidence.push(ev("manifest", m.file, `Service root from ${m.kind}`));
    if (fw) evidence.push(ev("framework", primary?.file ?? (r.rel || "."), `Detected framework ${fw}`));
    if (r.dockerfile) evidence.push(ev("port", r.dockerfile.rel, "Dockerfile present: runs as a container"));
    for (const l of r.listens.slice(0, 3)) evidence.push(evAt("port", l.file, l.line, l.port ? `Listens on port ${l.port}` : "Starts a server"));
    for (const u of r.units) evidence.push(evAt(u.kind === "compose" ? "compose" : u.kind === "helm" ? "helm" : "kubernetes", u.file, u.line, `Deployed as ${u.kind} "${u.name}"`));

    const port = r.listens.find((l) => l.port)?.port ?? r.dockerfile?.ports[0] ?? r.ports[0] ?? null;
    const node: GraphNode = {
      id: r.id, name: r.name, type: r.isRuntime ? "service" : "library", language: r.language, port,
      endpoints: [...new Set(openApiEndpoints.get(r) ?? [])].sort(), path: r.rel || ".", evidence,
    };
    if (fw) node.framework = fw;
    const stack = [...new Set(r.manifests.flatMap((m) => m.techStack))].sort();
    if (stack.length) node.techStack = stack;
    if (r.public) {
      node.public = true;
      node.exposure = r.units.filter((u) => u.public).map((u) => ({ direction: "ingress" as const, cidr: "0.0.0.0/0", port: u.ports[0] ?? null, source: u.file, line: u.line }));
    }
    builder.addNode(node);
    if (port) { const l = portIndex.get(port) ?? []; l.push(r.id); portIndex.set(port, l); }
  }

  // ---------------------------------------------------------------- 6. name resolution helpers
  const resolveAlias = (host: string): string | null => {
    let h = host.toLowerCase().replace(/\.$/, "");
    if (h.endsWith(".svc.cluster.local") || h.endsWith(".svc")) h = h.split(".")[0]!;
    if (h.includes(".")) return null;
    for (const v of aliasVariants(h)) { const id = aliasMap.get(v); if (id) return id; }
    return null;
  };
  const resolveLocalPort = (host: string, port?: number): string | null => {
    if (!port) return null;
    if (!(host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "host.docker.internal")) return null;
    const ids = portIndex.get(port);
    return ids && ids.length === 1 ? ids[0]! : null;
  };
  const targetType = (id: string) => {
    const t = builder.nodes.get(id)?.type;
    return t === "database" ? "database" : t === "queue" ? "queue" : t === "storage" ? "storage" : "http";
  };
  const internalTarget = (host: string, port?: number) => resolveLocalPort(host, port) ?? resolveAlias(host);

  /** Link `from` to whatever a host points at (vendor, repo service, compose infra). */
  const linkHost = (from: string, host: string, port: number | undefined, signal: Signal, evidence: GraphEvidence[]): string | null => {
    const vendor = matchHost(host);
    if (vendor) return linkEntity(from, vendor, signal, evidence);
    const target = internalTarget(host, port);
    if (target && target !== from) {
      builder.addEdge(from, target, targetType(target), signal, evidence);
      return target;
    }
    return null;
  };

  /** Environment set by deploy config (compose, k8s, helm, Dockerfile): where it points tells us what the service talks to. */
  const applyDeployEnv = (
    from: string,
    r: Root | null,
    entries: Array<{ name: string; value?: string; file: string; line?: number; kind: GraphEvidence["kind"] }>
  ) => {
    const readNames = new Set((r?.envReads ?? []).map((x) => normalizeKey(x.name)));
    const readEvidence = (name: string) =>
      (r?.envReads ?? []).filter((x) => normalizeKey(x.name) === normalizeKey(name)).map((x) => evAt("env", x.file, x.line, `Reads ${x.name}`));
    for (const e of entries) {
      const reads = readNames.has(normalizeKey(e.name));
      const note = evAt(e.kind, e.file, e.line, `${e.name} is set for ${builder.nodes.get(from)?.name ?? from}`);
      const value = e.value ?? "";
      const entity = value ? matchUri(value) : null;
      if (entity) {
        const to = linkEntity(from, entity, "iac", [note]);
        if (reads) builder.addEdge(from, to, edgeTypeFor(entity), "env-read", readEvidence(e.name));
        continue;
      }
      const looksLikeTarget = value && (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[a-z0-9._-]+(:\d{2,5})?$/i.test(value));
      if (looksLikeTarget && (reads || /url|host|endpoint|addr|uri/i.test(e.name))) {
        const u = parseUrl(value);
        const to = u ? linkHost(from, u.host, u.port, "iac", [note]) : null;
        if (to) {
          if (reads) builder.addEdge(from, to, targetType(to), "env-read", readEvidence(e.name));
          continue;
        }
      }
      const byName = matchEnv(e.name);
      if (byName) linkEntity(from, byName, "iac", [note]);
    }
  };

  // ---------------------------------------------------------------- 7. evidence per service
  for (const r of rootList) {
    const from = r.id;

    for (const { file, lang, sig } of importsByRoot.get(r) ?? []) {
      let entity: Entity | null = null;
      for (const c of [sig.spec, ...sig.also]) { entity = matchImport(lang, c); if (entity) break; }
      if (entity) {
        const label = entity.kind === "vendor" ? entity.vendor.name : entity.engine.name;
        linkEntity(from, entity, "sdk-import", [evAt("sdk-import", file, sig.line, `Imports ${sig.spec} (${label})`)]);
        if (entity.kind === "vendor") r.fileVendors.get(file)?.add(entity.id);
        else if (entity.engine.vendor) r.fileVendors.get(file)?.add(entity.engine.vendor);
        continue;
      }
      let target: Root | undefined;
      if (lang === "js") {
        if (sig.spec.startsWith(".")) {
          const resolved = path.posix.normalize(path.posix.join(dirOf(file), sig.spec));
          const d = deepestRoot(resolved);
          const other = d !== null ? roots.get(d) : undefined;
          if (other && other !== r) target = other;
        } else {
          const name = sig.spec.startsWith("@") ? sig.spec.split("/").slice(0, 2).join("/") : sig.spec.split("/")[0]!;
          target = manifestNames.get(name);
        }
      } else if (lang === "go") {
        for (const [mod, other] of goModules) if (sig.spec === mod || sig.spec.startsWith(mod + "/")) target = other;
      } else if (lang === "py") {
        const id = aliasMap.get(sig.spec.split(".")[0]!.toLowerCase());
        target = id ? rootList.find((x) => x.id === id) : undefined;
      }
      if (target && target !== r) {
        builder.addEdge(from, target.id, "import", "import", [evAt("import", file, sig.line, `Imports ${sig.spec} from ${target.name}`)]);
      } else if (includeLibraries && !sig.spec.startsWith(".") && !sig.spec.startsWith("/") && !sig.spec.startsWith("node:") && (lang === "js" || lang === "py" || lang === "go")) {
        const lib = sig.spec.startsWith("@") ? sig.spec.split("/").slice(0, 2).join("/") : (lang === "go" ? sig.spec : sig.spec.split(/[/.]/)[0]!);
        if (lib && !/^(os|sys|re|json|fs|path|http|https|net|url|util|crypto|events|stream|buffer|child_process|fmt|errors|io|strings|time|context)$/.test(lib)) {
          const id = `lib:${lib}`;
          builder.addNode({ id, name: lib, type: "library", language: "unknown", port: null, endpoints: [], path: "", evidence: [] });
          builder.addEdge(from, id, "import", "import", [evAt("import", file, sig.line, `Imports external library ${sig.spec}`)]);
        }
      }
    }

    for (const { file, line, vendor, constant } of rubyConstHits.get(r) ?? []) {
      const v = getVendor(vendor);
      const hasGem = r.manifests.some((m) => m.deps.some((d) => matchManifestDep(d.eco as ManifestEcosystem, d.name)?.id === vendor));
      if (v && hasGem) linkEntity(from, { kind: "vendor", id: v.id, vendor: v }, "sdk-import", [evAt("sdk-import", file, line, `References ${constant} from the ${v.name} gem`)]);
    }

    for (const { file, sig } of botoByRoot.get(r) ?? []) {
      const engine = getEngine(sig.service);
      if (engine) linkEntity(from, { kind: "engine", id: engine.id, engine }, "sdk-import", [evAt("sdk-import", file, sig.line, `boto3 client for ${sig.service}`)]);
    }

    const readNames = new Set<string>();
    for (const e of r.envReads) {
      readNames.add(normalizeKey(e.name));
      const entity = matchEnv(e.name);
      if (entity) linkEntity(from, entity, "env-read", [evAt("env", e.file, e.line, `Reads ${e.name}`)]);
    }
    const readEvidence = (name: string) =>
      r.envReads.filter((x) => normalizeKey(x.name) === normalizeKey(name)).map((x) => evAt("env", x.file, x.line, `Reads ${x.name}`));

    for (const { file, sig } of httpByRoot.get(r) ?? []) {
      const u = parseUrl(sig.url);
      if (!u) continue;
      const evidence = [evAt("http-call", file, sig.line, `Calls ${u.host}${u.port ? `:${u.port}` : ""}`)];
      const signal: Signal = sig.weak ? "http-weak" : "http-call";
      if (linkHost(from, u.host, u.port, signal, evidence)) continue;
      if (!sig.weak && u.host.includes(".") && !isIp(u.host) && !RESERVED_HOST.test(u.host) && !/\.(svc|cluster\.local|internal)$/i.test(u.host)) {
        const id = `ext:${u.host}`;
        builder.addNode({ id, name: u.host, type: "external", language: "unknown", port: null, endpoints: [], path: "", evidence: [] });
        builder.addEdge(from, id, "http", signal, evidence);
      }
    }
    for (const { file, sig } of uriByRoot.get(r) ?? []) {
      const entity = matchUri(sig.value);
      const rest = sig.value.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, "");
      if (!entity || rest.length < 3) continue;
      const label = entity.kind === "vendor" ? entity.vendor.name : entity.engine.name;
      linkEntity(from, entity, "connstring", [evAt("env", file, sig.line, `Connection string for ${label}`)]);
    }

    for (const c of r.config) {
      const uriEntity = matchUri(c.value);
      const keyEngineId = engineFromConfigKey(c.key, c.value) ?? engineFromAdoString(c.value);
      const keyEngine = keyEngineId ? getEngine(keyEngineId) : undefined;
      const target: Entity | null = uriEntity ?? (keyEngine ? { kind: "engine", id: keyEngine.id, engine: keyEngine } : null);
      if (target) {
        const label = target.kind === "vendor" ? target.vendor.name : target.engine.name;
        linkEntity(from, target, "connstring", [evAt("env", c.file, c.line, `${c.key} configures ${label}`)]);
        continue;
      }
      if (/^https?:\/\//.test(c.value) || /^[a-z0-9.-]+:\d{2,5}$/i.test(c.value)) {
        const u = parseUrl(c.value);
        if (u && readNames.has(normalizeKey(c.key))) {
          const to = linkHost(from, u.host, u.port, "iac", [evAt("env", c.file, c.line, `${c.key} points at ${u.host}`)]);
          if (to) builder.addEdge(from, to, targetType(to), "env-read", readEvidence(c.key));
        }
      }
    }

    applyDeployEnv(from, r, (r.dockerfile?.env ?? []).map((e) => ({ ...e, file: r.dockerfile!.rel, kind: "iac" as GraphEvidence["kind"] })));

    // Manifest dependencies corroborate existing edges; they never create an SDK/datastore edge alone.
    for (const m of r.manifests) {
      for (const d of m.deps) {
        if (d.dev) continue;
        const entity = matchManifestDep(d.eco as ManifestEcosystem, d.name);
        if (entity) {
          const id = entityNodeId(entity);
          const type = edgeTypeFor(entity);
          if (builder.hasEdge(from, id, type)) builder.addEdge(from, id, type, "dependency", [evAt("dependency", m.file, d.line, `Declares dependency ${d.name}`)]);
          continue;
        }
        const sibling = d.eco === "npm" ? manifestNames.get(d.name) : undefined;
        if (sibling && sibling !== r) {
          builder.addEdge(from, sibling.id, "import", "dependency", [evAt("dependency", m.file, d.line, `Depends on workspace package ${d.name}`)]);
        }
      }
    }

    // Example env files: extra evidence for edges that already exist, never an edge of their own.
    for (const d of r.declared) {
      const entity = matchEnv(d.name);
      if (!entity) continue;
      const id = entityNodeId(entity);
      const type = edgeTypeFor(entity);
      if (builder.hasEdge(from, id, type)) builder.addEdge(from, id, type, "declared", [evAt("declared", d.file, d.line, `${d.name} listed in ${baseOf(d.file)}`)]);
    }
  }

  // Deploy descriptors wire services together whether or not their source is in this repo.
  const rootByNodeId = new Map(rootList.map((r) => [r.id, r]));
  for (const [u, nodeId] of unitNodeId) {
    const kind = (u.kind === "compose" ? "compose" : u.kind === "helm" ? "helm" : "kubernetes") as GraphEvidence["kind"];
    applyDeployEnv(nodeId, rootByNodeId.get(nodeId) ?? null, u.env.map((e) => ({ ...e, file: u.file, kind })));
    for (const dep of u.dependsOn) {
      const to = resolveAlias(dep);
      if (to && to !== nodeId) builder.addEdge(nodeId, to, targetType(to), "compose", [evAt(kind, u.file, u.line, `${u.name} depends_on ${dep}`)]);
    }
  }

  // ---------------------------------------------------------------- 8. infrastructure as code
  if (iacResources.length) {
    mapIac(iacResources, {
      builder,
      resolveService: (names) => {
        for (const n of names) {
          const id = resolveAlias(n);
          if (id && id.startsWith("service:")) return id;
        }
        return null;
      },
    });
    const byEngine = new Map<string, string[]>();
    for (const n of builder.nodes.values()) {
      if (n.iac && n.engine) byEngine.set(n.engine, [...(byEngine.get(n.engine) ?? []), n.id]);
    }
    for (const [engineId, ids] of byEngine) {
      const engine = getEngine(engineId);
      if (!engine || ids.length !== 1) continue;
      const codeId = `${entityPrefix(engine)}:${engineId}`;
      if (builder.hasNode(codeId)) builder.mergeNodeInto(codeId, ids[0]!);
    }
  }
  const publicUnits = [...unitNodeId.entries()].filter(([u]) => u.public);
  if (publicUnits.length) {
    builder.addNode({ id: INTERNET_ID, name: "Internet", type: "network", language: "unknown", port: null, endpoints: [], path: "", public: true, evidence: [] });
    for (const [u, id] of publicUnits) {
      builder.addEdge(INTERNET_ID, id, "network", "iac-ref", [evAt(u.kind === "helm" ? "helm" : "kubernetes", u.file, u.line, `${u.name} is exposed by an Ingress or LoadBalancer Service`)]);
      const n = builder.nodes.get(id);
      if (n) n.public = true;
    }
  }

  // ---------------------------------------------------------------- 9. data classification
  const tag = (cls: DataClass, certainty: "evidenced" | "possible", evidence: GraphEvidence[]) => ({ class: cls, certainty, evidence });

  for (const r of rootList) {
    const dbEdges = builder.edgesFrom(r.id).filter((e) => e.type === "database");
    const byClass = new Map<DataClass, GraphEvidence[]>();
    const engineByClass = new Map<DataClass, Set<string>>();
    for (const fld of schemaFieldsByRoot.get(r) ?? []) {
      const cls = classifyField(fld.field, fld.typeHint);
      if (!cls) continue;
      const list = byClass.get(cls) ?? [];
      if (list.length < 5) list.push(evAt("schema", fld.file, fld.line, `${fld.entity}.${fld.field} holds ${cls}`));
      byClass.set(cls, list);
      if (fld.engine) engineByClass.set(cls, new Set([...(engineByClass.get(cls) ?? []), fld.engine]));
    }
    for (const [cls, evidence] of byClass) {
      const engines = engineByClass.get(cls);
      const bound = engines?.size
        ? dbEdges.filter((e) => { const eng = builder.nodes.get(e.to)?.engine; return eng !== undefined && engines.has(eng); })
        : [];
      const targets = bound.length ? bound : dbEdges;
      const certainty = bound.length || dbEdges.length === 1 ? "evidenced" : "possible";
      for (const t of targets) builder.addEdgeTag(r.id, t.to, t.type, tag(cls, certainty, evidence));
    }

    for (const e of builder.edgesFrom(r.id).filter((x) => x.to.startsWith("vendor:"))) {
      const vendor = getVendor(e.to.slice("vendor:".length));
      if (!vendor) continue;
      const evidenced = new Set<DataClass>();
      for (const { file, sig } of callsByRoot.get(r) ?? []) {
        if (!r.fileVendors.get(file)?.has(vendor.id)) continue;
        for (const rule of vendor.calls) {
          if (!rule.ids.includes(sig.id)) continue;
          if (rule.withArgs && !rule.withArgs.some((a) => sig.args.includes(a))) continue;
          evidenced.add(rule.class);
          builder.addEdgeTag(r.id, e.to, e.type, tag(rule.class, "evidenced", [evAt("call-site", file, sig.line, `${sig.id}(...) handles ${rule.class} for ${vendor.name}`)]));
        }
      }
      for (const cls of vendor.data) {
        if (evidenced.has(cls)) continue;
        builder.addEdgeTag(r.id, e.to, e.type, tag(cls, "possible", [ev("sdk-import", r.rel || ".", `${vendor.name} typically processes ${cls}`)]));
      }
    }
  }

  return builder.build({ repo, scannedAt, languageBreakdown: languageCounts, totalFiles });
}
