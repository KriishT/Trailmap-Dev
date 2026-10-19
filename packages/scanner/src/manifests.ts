import { XMLParser } from "fast-xml-parser";
import type { Language } from "@trailmap/graph";
import type { ManifestEcosystem } from "./catalog.js";

export interface Dep {
  name: string;
  eco: ManifestEcosystem;
  /** 1-based line in the manifest where the dependency is declared, if found. */
  line?: number;
  /** Development-only dependencies are not runtime evidence. */
  dev: boolean;
}

export type ManifestKind =
  | "package.json" | "requirements" | "pyproject" | "go.mod" | "pom.xml" | "gradle" | "Gemfile" | "csproj";

export interface Manifest {
  kind: ManifestKind;
  /** Repo-relative path of the manifest file. */
  file: string;
  language: Language;
  /** Package / module name as declared (used to resolve intra-repo imports). */
  name?: string;
  deps: Dep[];
  scripts: Record<string, string>;
  workspaces: string[];
  /** Frameworks detected from dependencies, most specific first. */
  frameworks: string[];
  techStack: string[];
  /** Aggregator manifests (workspace roots, maven parent poms) are not services themselves. */
  aggregator: boolean;
  /** True when the manifest declares itself as a web app (csproj Web SDK, etc.). */
  webApp: boolean;
  /** Library-style package: has a `main`/`exports`/`bin` but no start script. */
  hasBin: boolean;
}

export const SERVER_FRAMEWORKS = new Set([
  "nextjs", "nuxt", "remix", "gatsby", "express", "fastify", "hono", "koa", "nestjs",
  "fastapi", "django", "flask", "gin", "fiber", "echo", "spring", "micronaut", "quarkus",
  "rails", "sinatra", "aspnet",
]);

const NPM_FRAMEWORKS: Array<[string, string]> = [
  ["next", "nextjs"], ["nuxt", "nuxt"], ["@remix-run/node", "remix"], ["@remix-run/react", "remix"],
  ["gatsby", "gatsby"], ["@nestjs/core", "nestjs"], ["express", "express"], ["fastify", "fastify"],
  ["hono", "hono"], ["koa", "koa"], ["react", "react"], ["vue", "vue"], ["svelte", "svelte"], ["vite", "vite"],
];

const NPM_STACK: Record<string, string> = {
  tailwindcss: "tailwind", prisma: "prisma", "@prisma/client": "prisma", "drizzle-orm": "drizzle",
  typeorm: "typeorm", mongoose: "mongoose", "@trpc/server": "trpc", graphql: "graphql",
  "@apollo/server": "apollo", "socket.io": "socketio", zod: "zod", "@supabase/supabase-js": "supabase",
};

function lineOf(content: string, needle: string): number | undefined {
  const idx = content.indexOf(needle);
  if (idx === -1) return undefined;
  let line = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function emptyManifest(kind: ManifestKind, file: string, language: Language): Manifest {
  return {
    kind, file, language, deps: [], scripts: {}, workspaces: [], frameworks: [], techStack: [],
    aggregator: false, webApp: false, hasBin: false,
  };
}

function parsePackageJson(file: string, content: string, hasTsconfig: boolean): Manifest | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const m = emptyManifest("package.json", file, "javascript");
  m.name = typeof pkg.name === "string" ? pkg.name : undefined;
  m.scripts = (pkg.scripts as Record<string, string>) ?? {};
  const ws = pkg.workspaces as unknown;
  m.workspaces = Array.isArray(ws) ? (ws as string[]) : ((ws as { packages?: string[] } | undefined)?.packages ?? []);
  m.aggregator = m.workspaces.length > 0;
  m.hasBin = Boolean(pkg.bin);

  const sections: Array<[string, boolean]> = [
    ["dependencies", false], ["peerDependencies", false], ["optionalDependencies", false], ["devDependencies", true],
  ];
  const allNames = new Set<string>();
  for (const [section, dev] of sections) {
    const block = pkg[section] as Record<string, string> | undefined;
    if (!block) continue;
    for (const name of Object.keys(block)) {
      allNames.add(name);
      m.deps.push({ name, eco: "npm", line: lineOf(content, `"${name}"`), dev });
    }
  }
  for (const [dep, fw] of NPM_FRAMEWORKS) if (allNames.has(dep) && !m.frameworks.includes(fw)) m.frameworks.push(fw);
  for (const [dep, label] of Object.entries(NPM_STACK)) if (allNames.has(dep) && !m.techStack.includes(label)) m.techStack.push(label);
  m.language = hasTsconfig || allNames.has("typescript") ? "typescript" : "javascript";
  return m;
}

function parseRequirements(file: string, content: string): Manifest {
  const m = emptyManifest("requirements", file, "python");
  content.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-") || /^(git\+|https?:)/.test(line)) return;
    const name = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line)?.[1];
    if (name) m.deps.push({ name, eco: "pypi", line: idx + 1, dev: false });
  });
  applyPythonFrameworks(m);
  return m;
}

function parsePyproject(file: string, content: string): Manifest {
  const m = emptyManifest("pyproject", file, "python");
  m.name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(content)?.[1];
  const projDeps = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(content)?.[1];
  if (projDeps) {
    for (const mm of projDeps.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)[^"']*["']/g)) {
      m.deps.push({ name: mm[1]!, eco: "pypi", line: lineOf(content, mm[0]), dev: false });
    }
  }
  const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(content)?.[1];
  if (poetry) {
    for (const mm of poetry.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/gm)) {
      if (mm[1]!.toLowerCase() !== "python") m.deps.push({ name: mm[1]!, eco: "pypi", line: lineOf(content, mm[0].trim()), dev: false });
    }
  }
  applyPythonFrameworks(m);
  return m;
}

function applyPythonFrameworks(m: Manifest) {
  const names = new Set(m.deps.map((d) => d.name.toLowerCase()));
  for (const [dep, fw] of [["fastapi", "fastapi"], ["django", "django"], ["flask", "flask"]] as const) {
    if (names.has(dep)) m.frameworks.push(fw);
  }
  if (names.has("sqlalchemy")) m.techStack.push("sqlalchemy");
}

function parseGoMod(file: string, content: string): Manifest {
  const m = emptyManifest("go.mod", file, "go");
  m.name = /^\s*module\s+(\S+)/m.exec(content)?.[1];
  const lines = content.split("\n");
  let inBlock = false;
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) { inBlock = true; return; }
    if (inBlock && line === ")") { inBlock = false; return; }
    const single = /^require\s+(\S+)\s+v/.exec(line);
    const inner = inBlock ? /^(\S+)\s+v/.exec(line) : null;
    const name = single?.[1] ?? inner?.[1];
    if (name) m.deps.push({ name, eco: "go", line: idx + 1, dev: false });
  });
  const names = m.deps.map((d) => d.name);
  if (names.some((n) => n.includes("gin-gonic/gin"))) m.frameworks.push("gin");
  else if (names.some((n) => n.includes("gofiber/fiber"))) m.frameworks.push("fiber");
  else if (names.some((n) => n.includes("labstack/echo"))) m.frameworks.push("echo");
  return m;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function parsePom(file: string, content: string): Manifest | null {
  let doc: Record<string, unknown>;
  try {
    doc = new XMLParser({ ignoreAttributes: true }).parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const project = doc.project as Record<string, unknown> | undefined;
  if (!project) return null;
  const m = emptyManifest("pom.xml", file, "java");
  m.name = typeof project.artifactId === "string" ? project.artifactId : undefined;
  m.aggregator = project.packaging === "pom" || Boolean(project.modules);
  const parent = project.parent as Record<string, unknown> | undefined;
  if (parent && String(parent.artifactId ?? "").includes("spring-boot")) m.frameworks.push("spring");
  const deps = asArray(((project.dependencies as Record<string, unknown> | undefined)?.dependency) as Array<Record<string, unknown>> | Record<string, unknown> | undefined);
  for (const d of deps) {
    const g = String(d.groupId ?? "");
    const a = String(d.artifactId ?? "");
    if (!g || !a) continue;
    const scope = String(d.scope ?? "compile");
    m.deps.push({ name: `${g}:${a}`, eco: "maven", line: lineOf(content, `<artifactId>${a}</artifactId>`), dev: scope === "test" });
    if (a.startsWith("spring-boot-starter") && !m.frameworks.includes("spring")) m.frameworks.push("spring");
    if (a.startsWith("micronaut") && !m.frameworks.includes("micronaut")) m.frameworks.push("micronaut");
    if (a.startsWith("quarkus") && !m.frameworks.includes("quarkus")) m.frameworks.push("quarkus");
    if (a.includes("jpa") || a.includes("hibernate")) m.techStack.push("jpa");
  }
  return m;
}

function parseGradle(file: string, content: string): Manifest {
  const m = emptyManifest("gradle", file, "java");
  content.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    if (/org\.springframework\.boot/.test(line) && !m.frameworks.includes("spring")) m.frameworks.push("spring");
    const cfg = /^(implementation|api|compile|runtimeOnly|compileOnly|testImplementation|testRuntimeOnly|annotationProcessor|kapt)\b/.exec(line);
    if (!cfg) return;
    const coord = /["']([\w.-]+):([\w.-]+)(?::[^"']*)?["']/.exec(line);
    if (coord) {
      m.deps.push({ name: `${coord[1]}:${coord[2]}`, eco: "maven", line: idx + 1, dev: cfg[1]!.startsWith("test") });
      if (coord[2]!.startsWith("spring-boot-starter") && !m.frameworks.includes("spring")) m.frameworks.push("spring");
    }
  });
  return m;
}

function parseGemfile(file: string, content: string): Manifest {
  const m = emptyManifest("Gemfile", file, "ruby");
  content.split("\n").forEach((raw, idx) => {
    const name = /^\s*gem\s+["']([^"']+)["']/.exec(raw)?.[1];
    if (name) m.deps.push({ name, eco: "gems", line: idx + 1, dev: false });
  });
  const names = new Set(m.deps.map((d) => d.name));
  if (names.has("rails")) m.frameworks.push("rails");
  else if (names.has("sinatra")) m.frameworks.push("sinatra");
  return m;
}

function parseCsproj(file: string, content: string): Manifest {
  const m = emptyManifest("csproj", file, "unknown");
  m.language = "csharp";
  m.name = file.split("/").pop()?.replace(/\.csproj$/, "");
  m.webApp = /Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/.test(content);
  if (m.webApp) m.frameworks.push("aspnet");
  for (const mm of content.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) {
    m.deps.push({ name: mm[1]!, eco: "nuget", line: lineOf(content, mm[0]), dev: false });
    if (mm[1]!.startsWith("Microsoft.AspNetCore") && !m.frameworks.includes("aspnet")) m.frameworks.push("aspnet");
  }
  return m;
}

export function manifestKindForFile(rel: string): ManifestKind | null {
  const base = rel.split("/").pop() ?? rel;
  if (base === "package.json") return "package.json";
  if (/^requirements(-[\w]+)?\.txt$/.test(base)) return "requirements";
  if (base === "pyproject.toml") return "pyproject";
  if (base === "go.mod") return "go.mod";
  if (base === "pom.xml") return "pom.xml";
  if (base === "build.gradle" || base === "build.gradle.kts") return "gradle";
  if (base === "Gemfile") return "Gemfile";
  if (base.endsWith(".csproj")) return "csproj";
  return null;
}

export function parseManifest(rel: string, content: string, opts: { hasTsconfig?: boolean } = {}): Manifest | null {
  const kind = manifestKindForFile(rel);
  switch (kind) {
    case "package.json": return parsePackageJson(rel, content, opts.hasTsconfig ?? false);
    case "requirements": return parseRequirements(rel, content);
    case "pyproject": return parsePyproject(rel, content);
    case "go.mod": return parseGoMod(rel, content);
    case "pom.xml": return parsePom(rel, content);
    case "gradle": return parseGradle(rel, content);
    case "Gemfile": return parseGemfile(rel, content);
    case "csproj": return parseCsproj(rel, content);
    default: return null;
  }
}
