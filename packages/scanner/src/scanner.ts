import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import {
  Confidence,
  DependencyGraph,
  GraphEdge,
  GraphEvidence,
  GraphNode,
  ScanOptions,
} from "./types.js";
import { detectLanguage, detectLanguageFromFile } from "./detect-language.js";
import { parseImports } from "./parse-imports.js";
import {
  isKubernetesManifest,
  parseDockerCompose,
  parseKubernetesManifest,
  parseOpenApiSpec,
} from "./parse-infra.js";
import { parseCiCdFile } from "./parse-cicd.js";
import { classifyPackage, parseConnections } from "./parse-connections.js";

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.lock",
];

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx",
  ".py", ".go", ".java", ".rb",
]);

const SCANNABLE_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ".env", ".env.local", ".env.production", ".env.development",
]);

const FRAMEWORK_HINTS: { key: string; framework: string }[] = [
  { key: "next", framework: "nextjs" },
  { key: "nuxt", framework: "nuxt" },
  { key: "remix", framework: "remix" },
  { key: "gatsby", framework: "gatsby" },
  { key: "vite", framework: "vite" },
  { key: "react", framework: "react" },
  { key: "vue", framework: "vue" },
  { key: "svelte", framework: "svelte" },
  { key: "express", framework: "express" },
  { key: "fastify", framework: "fastify" },
  { key: "hono", framework: "hono" },
  { key: "koa", framework: "koa" },
  { key: "nestjs", framework: "nestjs" },
  { key: "@nestjs/core", framework: "nestjs" },
  { key: "fastapi", framework: "fastapi" },
  { key: "django", framework: "django" },
  { key: "flask", framework: "flask" },
  { key: "gin", framework: "gin" },
  { key: "fiber", framework: "fiber" },
  { key: "spring", framework: "spring" },
  { key: "rails", framework: "rails" },
];

export async function scan(options: ScanOptions): Promise<DependencyGraph> {
  const { rootDir, exclude = [], includeLibraries = false } = options;
  const absRoot = path.resolve(rootDir);
  const excludePatterns = [...DEFAULT_EXCLUDE, ...exclude];

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const languageCounts: Record<string, number> = {};
  let totalFiles = 0;

  const serviceRoots = await findServiceRoots(absRoot, excludePatterns);

  for (const serviceDir of serviceRoots) {
    const lang = detectLanguage(serviceDir);
    const relPath = path.relative(absRoot, serviceDir);
    const id = relPath.replace(/[/\\]/g, "-") || "root";
    const name = path.basename(serviceDir) === "." ? path.basename(absRoot) : path.basename(serviceDir);
    const evidence: GraphEvidence[] = [];

    const manifest = findServiceManifest(serviceDir);
    if (manifest) {
      evidence.push({
        kind: "manifest",
        source: path.relative(absRoot, manifest),
        detail: "Service root discovered from project manifest",
      });
    }

    const openApiFiles = await glob("**/{openapi,swagger}.{yaml,yml,json}", {
      cwd: serviceDir,
      ignore: excludePatterns,
      absolute: true,
    });
    const endpoints: string[] = [];
    for (const file of openApiFiles) {
      endpoints.push(...parseOpenApiSpec(file));
      evidence.push({
        kind: "openapi",
        source: path.relative(absRoot, file),
        detail: "OpenAPI spec contributed endpoint metadata",
      });
    }

    const port = await detectPort(serviceDir);
    const { framework, techStack } = detectFramework(serviceDir);

    if (port) {
      evidence.push({
        kind: "port",
        source: relPath || ".",
        detail: `Detected service port ${port}`,
      });
    }

    if (framework) {
      evidence.push({
        kind: "framework",
        source: relPath || ".",
        detail: `Detected framework ${framework}`,
      });
    }

    nodes.set(id, {
      id,
      name,
      type: "service",
      language: lang,
      port,
      endpoints,
      path: relPath || ".",
      framework,
      techStack,
      evidence,
    });

    languageCounts[lang] = (languageCounts[lang] ?? 0) + 1;
  }

  const composeFiles = await glob("**/docker-compose.{yml,yaml}", {
    cwd: absRoot,
    ignore: excludePatterns,
    absolute: true,
  });

  for (const composeFile of composeFiles) {
    const services = parseDockerCompose(composeFile);
    for (const svc of services) {
      const id = `compose-${svc.name}`;
      if (!nodes.has(svc.name) && !nodes.has(id)) {
        const isDb = isDbImage(svc.image ?? "");
        nodes.set(id, {
          id,
          name: svc.name,
          type: isDb ? "database" : "service",
          language: "unknown",
          port: svc.port ?? null,
          endpoints: [],
          path: path.relative(absRoot, path.dirname(composeFile)),
          evidence: [
            {
              kind: "compose",
              source: path.relative(absRoot, composeFile),
              detail: `Discovered from docker-compose service "${svc.name}"`,
            },
          ],
        });
      }

      for (const dep of svc.dependsOn ?? []) {
        const fromId = findNodeId(nodes, svc.name);
        const toId = findNodeId(nodes, dep);
        if (fromId && toId) {
          addEdge(edges, {
            from: fromId,
            to: toId,
            type: "http",
            confidence: "high",
            evidence: [
              {
                kind: "compose",
                source: path.relative(absRoot, composeFile),
                detail: `depends_on links "${svc.name}" to "${dep}"`,
              },
            ],
          });
        }
      }
    }
  }

  const yamlFiles = await glob("**/*.{yaml,yml}", {
    cwd: absRoot,
    ignore: [...excludePatterns, "**/docker-compose*"],
    absolute: true,
  });

  for (const yamlFile of yamlFiles) {
    if (!isKubernetesManifest(yamlFile)) continue;

    const services = parseKubernetesManifest(yamlFile);
    for (const svc of services) {
      const id = `k8s-${svc.name}`;
      if (!nodes.has(svc.name) && !nodes.has(id)) {
        nodes.set(id, {
          id,
          name: svc.name,
          type: "service",
          language: "unknown",
          port: svc.port ?? null,
          endpoints: [],
          path: path.relative(absRoot, path.dirname(yamlFile)),
          evidence: [
            {
              kind: "kubernetes",
              source: path.relative(absRoot, yamlFile),
              detail: `Discovered from Kubernetes manifest "${svc.name}"`,
            },
          ],
        });
      }
    }
  }

  const sourceFiles = await glob("**/*", {
    cwd: absRoot,
    ignore: excludePatterns,
    absolute: true,
    nodir: true,
    dot: true,
  });

  const portToNodeId = new Map<string, string>();
  for (const [id, node] of nodes) {
    if (node.port) portToNodeId.set(String(node.port), id);
  }

  for (const file of sourceFiles) {
    const ext = path.extname(file);
    const basename = path.basename(file);
    const isEnv = basename.startsWith(".env") || basename === ".env";

    if (!SCANNABLE_EXTENSIONS.has(ext) && !isEnv) continue;
    totalFiles++;

    try {
      const content = fs.readFileSync(file, "utf-8");
      const lang = detectLanguageFromFile(file);
      const fileServiceId = findServiceForFile(file, serviceRoots, absRoot);

      if (SOURCE_EXTENSIONS.has(ext)) {
        const imports = parseImports(content, lang);
        for (const imp of imports) {
          if (!imp.isExternal || imp.isRelative) continue;

          const targetId = findNodeByPackageName(nodes, imp.source);
          if (targetId && fileServiceId && targetId !== fileServiceId) {
            addEdge(edges, {
              from: fileServiceId,
              to: targetId,
              type: "import",
              confidence: "medium",
              evidence: [
                {
                  kind: "import",
                  source: path.relative(absRoot, file),
                  detail: `Imports package "${imp.source}"`,
                },
              ],
            });
            continue;
          }

          const { kind, name } = classifyPackage(imp.source);
          if (kind && name && fileServiceId) {
            const nodeId = `${kind}-${name}`;
            if (!nodes.has(nodeId)) {
              nodes.set(nodeId, {
                id: nodeId,
                name,
                type: kind === "database" ? "database" : "saas",
                language: "unknown",
                port: null,
                endpoints: [],
                path: "",
                evidence: [
                  {
                    kind: "package-classification",
                    source: path.relative(absRoot, file),
                    detail: `Package "${imp.source}" classified as ${kind} "${name}"`,
                  },
                ],
              });
            }

            addEdge(edges, {
              from: fileServiceId,
              to: nodeId,
              type: kind === "database" ? "database" : "http",
              confidence: "high",
              evidence: [
                {
                  kind: "package-classification",
                  source: path.relative(absRoot, file),
                  detail: `Package "${imp.source}" implies dependency on ${name}`,
                },
              ],
            });
            continue;
          }

          if (includeLibraries && !targetId) {
            const libId = `lib-${imp.source.replace(/[@/]/g, "-")}`;
            if (!nodes.has(libId)) {
              nodes.set(libId, {
                id: libId,
                name: imp.source,
                type: "library",
                language: "unknown",
                port: null,
                endpoints: [],
                path: "",
                evidence: [
                  {
                    kind: "import",
                    source: path.relative(absRoot, file),
                    detail: `External library "${imp.source}"`,
                  },
                ],
              });
            }

            if (fileServiceId) {
              addEdge(edges, {
                from: fileServiceId,
                to: libId,
                type: "import",
                confidence: "high",
                evidence: [
                  {
                    kind: "import",
                    source: path.relative(absRoot, file),
                    detail: `Imports external library "${imp.source}"`,
                  },
                ],
              });
            }
          }
        }
      }

      const connections = parseConnections(content, file);
      for (const conn of connections) {
        if (!fileServiceId) continue;

        if (conn.kind === "http") {
          const portMatch = conn.target.match(/^localhost:(\d+)$/);
          if (portMatch) {
            const targetId = portToNodeId.get(portMatch[1] ?? "");
            if (targetId && targetId !== fileServiceId) {
              addEdge(edges, {
                from: fileServiceId,
                to: targetId,
                type: "http",
                confidence: "high",
                evidence: [
                  {
                    kind: "http-call",
                    source: path.relative(absRoot, file),
                    detail: conn.detail,
                  },
                ],
              });
            }
          } else if (conn.target !== "env-url" && !conn.target.startsWith("env-")) {
            const nodeId = `ext-${conn.target.replace(/[.:]/g, "-")}`;
            if (!nodes.has(nodeId)) {
              nodes.set(nodeId, {
                id: nodeId,
                name: conn.target,
                type: "external",
                language: "unknown",
                port: null,
                endpoints: [],
                path: "",
                evidence: [
                  {
                    kind: "http-call",
                    source: path.relative(absRoot, file),
                    detail: `References external host "${conn.target}"`,
                  },
                ],
              });
            }

            addEdge(edges, {
              from: fileServiceId,
              to: nodeId,
              type: "http",
              confidence: conn.confidence,
              evidence: [
                {
                  kind: "http-call",
                  source: path.relative(absRoot, file),
                  detail: conn.detail,
                },
              ],
            });
          }
        }

        if (conn.kind === "database") {
          const nodeId = `database-${conn.target}`;
          if (!nodes.has(nodeId)) {
            nodes.set(nodeId, {
              id: nodeId,
              name: conn.target,
              type: "database",
              language: "unknown",
              port: null,
              endpoints: [],
              path: "",
              evidence: [
                {
                  kind: "env",
                  source: path.relative(absRoot, file),
                  detail: `Database dependency "${conn.target}" inferred from environment or code`,
                },
              ],
            });
          }

          addEdge(edges, {
            from: fileServiceId,
            to: nodeId,
            type: "database",
            confidence: conn.confidence,
            evidence: [
              {
                kind: "env",
                source: path.relative(absRoot, file),
                detail: conn.detail,
              },
            ],
          });
        }

        if (conn.kind === "queue") {
          const nodeId = `queue-${conn.target}`;
          if (!nodes.has(nodeId)) {
            nodes.set(nodeId, {
              id: nodeId,
              name: conn.target,
              type: "external",
              language: "unknown",
              port: null,
              endpoints: [],
              path: "",
              evidence: [
                {
                  kind: "env",
                  source: path.relative(absRoot, file),
                  detail: `Queue dependency "${conn.target}" inferred from environment or code`,
                },
              ],
            });
          }

          addEdge(edges, {
            from: fileServiceId,
            to: nodeId,
            type: "queue",
            confidence: conn.confidence,
            evidence: [
              {
                kind: "env",
                source: path.relative(absRoot, file),
                detail: conn.detail,
              },
            ],
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  const ciFiles = await glob(
    "**/{.github/workflows/*.yml,.circleci/config.yml,Jenkinsfile}",
    { cwd: absRoot, ignore: excludePatterns, absolute: true }
  );
  for (const ciFile of ciFiles) {
    parseCiCdFile(ciFile);
  }

  consolidateNodes(nodes, edges);

  return {
    meta: {
      repo: path.basename(absRoot),
      scanned_at: new Date().toISOString(),
      language_breakdown: languageCounts,
      total_files: totalFiles,
    },
    nodes: Array.from(nodes.values()),
    edges: deduplicateEdges(edges),
  };
}

function detectFramework(serviceDir: string): { framework: string | undefined; techStack: string[] } {
  const pkgPath = path.join(serviceDir, "package.json");
  const techStack: string[] = [];
  let framework: string | undefined;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    for (const { key, framework: hintedFramework } of FRAMEWORK_HINTS) {
      if (allDeps[key] !== undefined) {
        if (!framework) framework = hintedFramework;
        break;
      }
    }

    const stackPackages: Record<string, string> = {
      "tailwindcss": "tailwind",
      "@tailwindcss/vite": "tailwind",
      "prisma": "prisma",
      "@prisma/client": "prisma",
      "drizzle-orm": "drizzle",
      "typeorm": "typeorm",
      "mongoose": "mongoose",
      "trpc": "trpc",
      "@trpc/server": "trpc",
      "graphql": "graphql",
      "@apollo/server": "apollo",
      "apollo-server": "apollo",
      "socket.io": "socketio",
      "ws": "websocket",
      "zod": "zod",
      "redis": "redis",
      "ioredis": "redis",
      "@supabase/supabase-js": "supabase",
      "firebase-admin": "firebase",
      "stripe": "stripe",
      "openai": "openai",
      "resend": "resend",
      "@clerk/nextjs": "clerk",
    };

    for (const [pkg, label] of Object.entries(stackPackages)) {
      if (allDeps[pkg] !== undefined && !techStack.includes(label)) {
        techStack.push(label);
      }
    }
  } catch {
    // Ignore malformed package metadata
  }

  try {
    const req = fs.readFileSync(path.join(serviceDir, "requirements.txt"), "utf-8");
    if (/^fastapi/im.test(req)) framework = "fastapi";
    else if (/^django/im.test(req)) framework = "django";
    else if (/^flask/im.test(req)) framework = "flask";
  } catch {
    // Ignore missing Python manifests
  }

  try {
    const goMod = fs.readFileSync(path.join(serviceDir, "go.mod"), "utf-8");
    if (/gin-gonic\/gin/.test(goMod)) framework = "gin";
    else if (/gofiber\/fiber/.test(goMod)) framework = "fiber";
    else if (/labstack\/echo/.test(goMod)) framework = "echo";
  } catch {
    // Ignore missing Go manifests
  }

  return { framework, techStack };
}

async function findServiceRoots(rootDir: string, ignore: string[]): Promise<string[]> {
  const manifestFiles = [
    "package.json", "go.mod", "pom.xml", "build.gradle",
    "requirements.txt", "pyproject.toml", "Gemfile",
  ];

  const rootPkgPath = path.join(rootDir, "package.json");
  let workspaceDirs: string[] = [];
  try {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    const workspaces: string[] = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : rootPkg.workspaces?.packages ?? [];

    for (const pattern of workspaces) {
      const matched = await glob(pattern, { cwd: rootDir, absolute: true });
      for (const match of matched) {
        if (fs.existsSync(path.join(match, "package.json"))) {
          workspaceDirs.push(match);
        }
      }
    }
  } catch {
    // Ignore malformed workspace config
  }

  if (workspaceDirs.length > 0) return workspaceDirs;

  const roots = new Set<string>();
  for (const manifest of manifestFiles) {
    const files = await glob(`**/${manifest}`, {
      cwd: rootDir,
      ignore,
      absolute: true,
    });
    for (const file of files) roots.add(path.dirname(file));
  }

  if (roots.size === 0) return [rootDir];

  const allRoots = Array.from(roots).sort((a, b) => a.length - b.length);
  const hasChildren = new Set<string>();
  for (const root of allRoots) {
    for (const other of allRoots) {
      if (other !== root && other.startsWith(root + path.sep)) {
        hasChildren.add(root);
        break;
      }
    }
  }

  const leafRoots = allRoots.filter((root) => !hasChildren.has(root));
  return leafRoots.length > 0 ? leafRoots : [rootDir];
}

function findServiceManifest(serviceDir: string): string | null {
  const candidates = [
    "package.json",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "requirements.txt",
    "pyproject.toml",
    "Gemfile",
  ];

  for (const file of candidates) {
    const candidate = path.join(serviceDir, file);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

async function detectPort(serviceDir: string): Promise<number | null> {
  const pkgPath = path.join(serviceDir, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const start: string = pkg?.scripts?.start ?? pkg?.scripts?.dev ?? "";
    const portMatch = start.match(/(?:PORT=|--port\s+|:\s*)(\d{4,5})/);
    if (portMatch?.[1]) return parseInt(portMatch[1], 10);
  } catch {
    // Ignore malformed package metadata
  }

  const envPath = path.join(serviceDir, ".env");
  try {
    const env = fs.readFileSync(envPath, "utf-8");
    const portMatch = env.match(/^PORT=(\d+)/m);
    if (portMatch?.[1]) return parseInt(portMatch[1], 10);
  } catch {
    // Ignore missing env files
  }

  return null;
}

function findServiceForFile(
  filePath: string,
  serviceRoots: string[],
  absRoot: string
): string | null {
  let bestMatch: string | null = null;
  let bestLen = 0;

  for (const root of serviceRoots) {
    if (filePath.startsWith(root) && root.length > bestLen) {
      bestLen = root.length;
      bestMatch = root;
    }
  }

  if (!bestMatch) return null;
  const relPath = path.relative(absRoot, bestMatch);
  return relPath.replace(/[/\\]/g, "-") || "root";
}

function findNodeId(nodes: Map<string, GraphNode>, name: string): string | null {
  if (nodes.has(name)) return name;
  for (const [id, node] of nodes) {
    if (node.name === name) return id;
  }
  return null;
}

function findNodeByPackageName(nodes: Map<string, GraphNode>, packageName: string): string | null {
  const bare = packageName.replace(/^@[^/]+\//, "");
  for (const [id, node] of nodes) {
    if (node.type === "service" && (node.name === bare || node.name === packageName)) return id;
  }
  return null;
}

function addEdge(edges: GraphEdge[], edge: GraphEdge) {
  const existing = edges.find(
    (candidate) =>
      candidate.from === edge.from &&
      candidate.to === edge.to &&
      candidate.type === edge.type
  );

  if (!existing) {
    edges.push(edge);
    return;
  }

  if (confidenceRank(edge.confidence) > confidenceRank(existing.confidence)) {
    existing.confidence = edge.confidence;
  }

  existing.evidence = mergeEvidence(existing.evidence, edge.evidence);
}

function confidenceRank(confidence: Confidence): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}

function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}->${edge.to}->${edge.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeEvidence(
  existing: GraphEvidence[] | undefined,
  incoming: GraphEvidence[] | undefined
): GraphEvidence[] {
  const merged = [...(existing ?? [])];

  for (const item of incoming ?? []) {
    if (!merged.some((entry) => entry.kind === item.kind && entry.source === item.source && entry.detail === item.detail)) {
      merged.push(item);
    }
  }

  return merged;
}

function isDbImage(image: string): boolean {
  const dbKeywords = ["postgres", "mysql", "mongodb", "redis", "elasticsearch", "cassandra", "sqlite"];
  return dbKeywords.some((keyword) => image.toLowerCase().includes(keyword));
}

function consolidateNodes(nodes: Map<string, GraphNode>, edges: GraphEdge[]) {
  mergeDuplicateNamedNodes(nodes, edges);

  const canonicalNodes = new Map<string, string>();
  for (const [id, node] of nodes) {
    if (node.type === "database" || node.type === "saas") {
      canonicalNodes.set(node.name, id);
    }
  }

  for (const [id, node] of [...nodes.entries()]) {
    if (node.type !== "external") continue;

    const canonical = canonicalNodes.get(node.name);
    if (!canonical || canonical === id) continue;

    for (const edge of edges) {
      if (edge.from === id) edge.from = canonical;
      if (edge.to === id) edge.to = canonical;
    }

    const canonicalNode = nodes.get(canonical);
    if (canonicalNode) {
      canonicalNode.evidence = mergeEvidence(canonicalNode.evidence, node.evidence);
    }

    nodes.delete(id);
  }
}

function mergeDuplicateNamedNodes(nodes: Map<string, GraphNode>, edges: GraphEdge[]) {
  const groups = new Map<string, Array<[string, GraphNode]>>();

  for (const entry of nodes.entries()) {
    const [id, node] = entry;
    const key = `${node.type}:${node.name.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push([id, node]);
    groups.set(key, group);
  }

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    const canonical = [...group].sort((a, b) => nodePriority(b[1]) - nodePriority(a[1]))[0];
    if (!canonical) continue;
    const [canonicalId, canonicalNode] = canonical;

    for (const [id, node] of group) {
      if (id === canonicalId) continue;

      if (!canonicalNode.port && node.port) canonicalNode.port = node.port;
      if ((!canonicalNode.path || canonicalNode.path === ".") && node.path) canonicalNode.path = node.path;
      if (!canonicalNode.framework && node.framework) canonicalNode.framework = node.framework;
      canonicalNode.endpoints = uniqueStrings([...(canonicalNode.endpoints ?? []), ...(node.endpoints ?? [])]);
      canonicalNode.techStack = uniqueStrings([...(canonicalNode.techStack ?? []), ...(node.techStack ?? [])]);
      canonicalNode.evidence = mergeEvidence(canonicalNode.evidence, node.evidence);

      for (const edge of edges) {
        if (edge.from === id) edge.from = canonicalId;
        if (edge.to === id) edge.to = canonicalId;
      }

      nodes.delete(id);
    }
  }
}

function nodePriority(node: GraphNode): number {
  let score = 0;
  if (node.path && node.path !== ".") score += 4;
  if (node.framework) score += 3;
  if (node.port) score += 2;
  if (node.endpoints.length > 0) score += 2;
  score += (node.evidence?.length ?? 0) * 0.1;
  return score;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
