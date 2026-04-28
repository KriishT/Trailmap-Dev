import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import {
  DependencyGraph,
  GraphEdge,
  GraphNode,
  Language,
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
import { parseConnections, classifyPackage } from "./parse-connections.js";

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

// Framework detection from package.json dependencies
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

  // --- Step 1: Find service directories
  const serviceRoots = await findServiceRoots(absRoot, excludePatterns);

  for (const serviceDir of serviceRoots) {
    const lang = detectLanguage(serviceDir);
    const relPath = path.relative(absRoot, serviceDir);
    const id = relPath.replace(/[/\\]/g, "-") || "root";
    const name = path.basename(serviceDir) === "." ? path.basename(absRoot) : path.basename(serviceDir);

    // OpenAPI spec endpoints
    const openApiFiles = await glob("**/{openapi,swagger}.{yaml,yml,json}", {
      cwd: serviceDir,
      ignore: excludePatterns,
      absolute: true,
    });
    const endpoints: string[] = [];
    for (const f of openApiFiles) endpoints.push(...parseOpenApiSpec(f));

    const port = await detectPort(serviceDir);
    const { framework, techStack } = detectFramework(serviceDir);

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
    });

    languageCounts[lang] = (languageCounts[lang] ?? 0) + 1;
  }

  // --- Step 2: Parse docker-compose for services and dependencies
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
        });
      }

      for (const dep of svc.dependsOn ?? []) {
        const fromId = findNodeId(nodes, svc.name);
        const toId = findNodeId(nodes, dep);
        if (fromId && toId) {
          edges.push({ from: fromId, to: toId, type: "http", confidence: "high" });
        }
      }
    }
  }

  // --- Step 3: Parse Kubernetes manifests
  const yamlFiles = await glob("**/*.{yaml,yml}", {
    cwd: absRoot,
    ignore: [...excludePatterns, "**/docker-compose*"],
    absolute: true,
  });

  for (const yamlFile of yamlFiles) {
    if (isKubernetesManifest(yamlFile)) {
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
          });
        }
      }
    }
  }

  // --- Step 4: Scan source files for imports, HTTP calls, and env-var connections
  const sourceFiles = await glob("**/*", {
    cwd: absRoot,
    ignore: excludePatterns,
    absolute: true,
    nodir: true,
  });

  // Build a port → nodeId lookup for localhost references
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

      // --- 4a. Package imports → detect cross-service and DB/SaaS nodes
      if (SOURCE_EXTENSIONS.has(ext)) {
        const imports = parseImports(content, lang);
        for (const imp of imports) {
          if (!imp.isExternal || imp.isRelative) continue;

          // Check if matches a known sibling service
          const targetId = findNodeByPackageName(nodes, imp.source);
          if (targetId && fileServiceId && targetId !== fileServiceId) {
            if (!edgeExists(edges, fileServiceId, targetId)) {
              edges.push({ from: fileServiceId, to: targetId, type: "import", confidence: "medium" });
            }
            continue;
          }

          // Classify as DB or SaaS package
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
              });
            }
            const edgeType = kind === "database" ? "database" : "http";
            if (!edgeExists(edges, fileServiceId, nodeId)) {
              edges.push({ from: fileServiceId, to: nodeId, type: edgeType, confidence: "high" });
            }
            continue;
          }

          // Generic library node (if includeLibraries)
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
              });
            }
            if (fileServiceId && !edgeExists(edges, fileServiceId, libId)) {
              edges.push({ from: fileServiceId, to: libId, type: "import", confidence: "high" });
            }
          }
        }
      }

      // --- 4b. Connection detection (HTTP calls, env vars)
      const connections = parseConnections(content, file);
      for (const conn of connections) {
        if (!fileServiceId) continue;

        if (conn.kind === "http") {
          // localhost:PORT → match to a known service
          const portMatch = conn.target.match(/^localhost:(\d+)$/);
          if (portMatch) {
            const targetId = portToNodeId.get(portMatch[1] ?? "");
            if (targetId && targetId !== fileServiceId) {
              if (!edgeExists(edges, fileServiceId, targetId)) {
                edges.push({ from: fileServiceId, to: targetId, type: "http", confidence: "high" });
              }
            }
          } else if (conn.target !== "env-url" && !conn.target.startsWith("env-")) {
            // External hostname — create/link an external node
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
              });
            }
            if (!edgeExists(edges, fileServiceId, nodeId)) {
              edges.push({ from: fileServiceId, to: nodeId, type: "http", confidence: conn.confidence });
            }
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
            });
          }
          if (!edgeExists(edges, fileServiceId, nodeId)) {
            edges.push({ from: fileServiceId, to: nodeId, type: "database", confidence: conn.confidence });
          }
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
            });
          }
          if (!edgeExists(edges, fileServiceId, nodeId)) {
            edges.push({ from: fileServiceId, to: nodeId, type: "queue", confidence: conn.confidence });
          }
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  // --- Step 5: Parse CI/CD for additional service signals
  const ciFiles = await glob(
    "**/{.github/workflows/*.yml,.circleci/config.yml,Jenkinsfile}",
    { cwd: absRoot, ignore: excludePatterns, absolute: true }
  );
  for (const ciFile of ciFiles) {
    parseCiCdFile(ciFile);
  }

  // Deduplicate: prefer "database-X" over "ext-X" when both exist for same name
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

    for (const { key, framework: fw } of FRAMEWORK_HINTS) {
      if (allDeps[key] !== undefined) {
        if (!framework) framework = fw;
        break;
      }
    }

    // Build techStack from well-known packages
    const STACK_PACKAGES: Record<string, string> = {
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

    for (const [pkg, label] of Object.entries(STACK_PACKAGES)) {
      if (allDeps[pkg] !== undefined && !techStack.includes(label)) {
        techStack.push(label);
      }
    }
  } catch {}

  // Python: check requirements.txt or pyproject.toml
  try {
    const reqPath = path.join(serviceDir, "requirements.txt");
    const req = fs.readFileSync(reqPath, "utf-8");
    if (/^fastapi/im.test(req)) framework = "fastapi";
    else if (/^django/im.test(req)) framework = "django";
    else if (/^flask/im.test(req)) framework = "flask";
  } catch {}

  // Go: check go.mod
  try {
    const goMod = fs.readFileSync(path.join(serviceDir, "go.mod"), "utf-8");
    if (/gin-gonic\/gin/.test(goMod)) framework = "gin";
    else if (/gofiber\/fiber/.test(goMod)) framework = "fiber";
    else if (/labstack\/echo/.test(goMod)) framework = "echo";
  } catch {}

  return { framework, techStack };
}

async function findServiceRoots(rootDir: string, ignore: string[]): Promise<string[]> {
  const MANIFEST_FILES = [
    "package.json", "go.mod", "pom.xml", "build.gradle",
    "requirements.txt", "pyproject.toml", "Gemfile",
  ];

  // Check for monorepo workspace
  const rootPkgPath = path.join(rootDir, "package.json");
  let workspaceDirs: string[] = [];
  try {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    const workspaces: string[] = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : rootPkg.workspaces?.packages ?? [];

    for (const pattern of workspaces) {
      const matched = await glob(pattern, { cwd: rootDir, absolute: true });
      for (const m of matched) {
        if (fs.existsSync(path.join(m, "package.json"))) {
          workspaceDirs.push(m);
        }
      }
    }
  } catch {}

  if (workspaceDirs.length > 0) return workspaceDirs;

  // Find all manifest files and keep leaf-level roots
  const roots = new Set<string>();
  for (const manifest of MANIFEST_FILES) {
    const files = await glob(`**/${manifest}`, {
      cwd: rootDir,
      ignore,
      absolute: true,
    });
    for (const f of files) roots.add(path.dirname(f));
  }

  if (roots.size === 0) return [rootDir];

  const allRoots = Array.from(roots).sort((a, b) => a.length - b.length);
  const hasChildren = new Set<string>();
  for (const r of allRoots) {
    for (const other of allRoots) {
      if (other !== r && other.startsWith(r + path.sep)) {
        hasChildren.add(r);
        break;
      }
    }
  }

  const leafRoots = allRoots.filter(r => !hasChildren.has(r));
  return leafRoots.length > 0 ? leafRoots : [rootDir];
}

async function detectPort(serviceDir: string): Promise<number | null> {
  const pkgPath = path.join(serviceDir, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const start: string = pkg?.scripts?.start ?? pkg?.scripts?.dev ?? "";
    const portMatch = start.match(/(?:PORT=|--port\s+|:\s*)(\d{4,5})/);
    if (portMatch?.[1]) return parseInt(portMatch[1], 10);
  } catch {}

  const envPath = path.join(serviceDir, ".env");
  try {
    const env = fs.readFileSync(envPath, "utf-8");
    const portMatch = env.match(/^PORT=(\d+)/m);
    if (portMatch?.[1]) return parseInt(portMatch[1], 10);
  } catch {}

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

function edgeExists(edges: GraphEdge[], from: string, to: string): boolean {
  return edges.some((e) => e.from === from && e.to === to);
}

function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.from}→${e.to}→${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDbImage(image: string): boolean {
  const dbKeywords = ["postgres", "mysql", "mongodb", "redis", "elasticsearch", "cassandra", "sqlite"];
  return dbKeywords.some((kw) => image.toLowerCase().includes(kw));
}

// If we have both "database-X" and "ext-X" for the same underlying service, keep database-X
function consolidateNodes(nodes: Map<string, GraphNode>, edges: GraphEdge[]) {
  const dbNodes = new Map<string, string>(); // name → id
  for (const [id, node] of nodes) {
    if (node.type === "database" || node.type === "saas") {
      dbNodes.set(node.name, id);
    }
  }

  for (const [id, node] of [...nodes.entries()]) {
    if (node.type === "external") {
      const canonical = dbNodes.get(node.name);
      if (canonical && canonical !== id) {
        // Redirect edges
        for (const edge of edges) {
          if (edge.from === id) edge.from = canonical;
          if (edge.to === id) edge.to = canonical;
        }
        nodes.delete(id);
      }
    }
  }
}
