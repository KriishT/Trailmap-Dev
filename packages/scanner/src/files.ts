import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

export const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/site-packages/**",
  "**/target/**",
  "**/obj/**",
  "**/.gradle/**",
  "**/.terraform/**",
  "**/.idea/**",
  "**/.vscode/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.map",
  "**/*.lock",
  "**/package-lock.json",
];

/** Why a file is not used as evidence. Undefined means it is real project code/config. */
export type IgnoredReason = "test" | "fixture" | "doc" | "vendored";

export interface FileInfo {
  abs: string;
  /** Repo-relative path with forward slashes. */
  rel: string;
  ext: string;
  size: number;
  ignored?: IgnoredReason;
  /** `.env.example` style files: they declare variables but prove nothing at runtime. */
  declaredOnly: boolean;
}

export interface WalkResult {
  files: FileInfo[];
  skippedLarge: number;
  skippedBinary: number;
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svgz", ".pdf", ".zip", ".gz", ".tgz",
  ".tar", ".7z", ".rar", ".jar", ".war", ".class", ".dll", ".exe", ".so", ".dylib", ".bin", ".wasm",
  ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp3", ".mp4", ".mov", ".avi", ".webm", ".psd", ".pyc",
  ".o", ".a", ".node",
]);

const VENDORED_DIRS = new Set([
  "vendor", "vendors", "third_party", "third-party", "thirdparty", "bower_components", "pods",
]);
const TEST_DIRS = new Set([
  "test", "tests", "__tests__", "spec", "specs", "e2e", "cypress", "__mocks__", "integration-tests",
]);
const FIXTURE_DIRS = new Set(["fixtures", "fixture", "__fixtures__", "testdata", "test-data", "snapshots", "__snapshots__"]);
const DOC_DIRS = new Set(["docs", "doc", "documentation", "wiki"]);
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".adoc"]);

const TEST_FILE_PATTERNS = [
  /\.(test|spec|stories|story)\.[a-z]+$/i,
  /_test\.(go|py|rb)$/i,
  /_spec\.rb$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /(^|\/)conftest\.py$/i,
  /[^/]+(Test|Tests|IT|Spec)\.(java|kt|cs)$/,
  /(^|\/)src\/test\//,
];

export function classifyPath(rel: string): IgnoredReason | undefined {
  const lower = rel.toLowerCase();
  const segments = lower.split("/");
  const dirs = segments.slice(0, -1);
  if (dirs.some((d) => VENDORED_DIRS.has(d))) return "vendored";
  if (dirs.some((d) => FIXTURE_DIRS.has(d))) return "fixture";
  if (dirs.some((d) => TEST_DIRS.has(d))) return "test";
  if (TEST_FILE_PATTERNS.some((re) => re.test(rel))) return "test";
  if (dirs.some((d) => DOC_DIRS.has(d)) || DOC_EXTENSIONS.has(path.extname(lower))) return "doc";
  return undefined;
}

const DECLARED_ONLY = /^\.env(\.[a-z0-9_-]+)*\.(example|sample|template|dist|defaults?)$|^\.env\.example$|^example\.env$/i;

export function isDeclaredOnlyName(base: string): boolean {
  return DECLARED_ONLY.test(base);
}

export interface WalkOptions {
  exclude?: string[];
  maxFileBytes?: number;
}

export async function walk(root: string, options: WalkOptions = {}): Promise<WalkResult> {
  const maxBytes = options.maxFileBytes ?? 1024 * 1024;
  const matches = await glob("**/*", {
    cwd: root,
    ignore: [...DEFAULT_EXCLUDE, ...(options.exclude ?? [])],
    nodir: true,
    dot: true,
    posix: true,
  });
  matches.sort();

  const files: FileInfo[] = [];
  let skippedLarge = 0;
  let skippedBinary = 0;
  for (const rel of matches) {
    const ext = path.extname(rel).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      skippedBinary++;
      continue;
    }
    const abs = path.join(root, rel);
    let size: number;
    try {
      size = fs.statSync(abs).size;
    } catch {
      continue;
    }
    if (size > maxBytes) {
      skippedLarge++;
      continue;
    }
    files.push({
      abs,
      rel,
      ext,
      size,
      ignored: classifyPath(rel),
      declaredOnly: isDeclaredOnlyName(path.basename(rel)),
    });
  }
  return { files, skippedLarge, skippedBinary };
}

const CREDENTIALS_IN_URI = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@"'`]+:[^\s/@"'`]*@/gi;
const LONG_SECRETISH = /(["'`])[A-Za-z0-9_\-+/=]{24,}\1/g;
// Well-known credential shapes: Stripe, GitHub, AWS, Slack, SendGrid keys and JWTs.
const KNOWN_TOKENS =
  /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{4,}|gh[pousr]_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{8,}|SG\.[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/g;
// `NAME_SECRET: value`, `password = "value"`. Env lookups such as `api_key=os.environ[...]` stay readable.
const SECRET_ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)(?!process\.env|import\.meta|os\.|ENV\b|System\.|Environment\.|\$|<|%|\*\*\*)([^\s"',;)]+)\3/gi;

/**
 * A short, safe excerpt of a source line for use as evidence. Masks URI credentials, values
 * assigned to secret-named keys, and well-known token formats, and caps the length.
 */
export function makeSnippet(line: string | undefined, max = 120): string | undefined {
  if (!line) return undefined;
  let s = line.trim().replace(/\s+/g, " ");
  if (!s) return undefined;
  s = s
    .replace(CREDENTIALS_IN_URI, "$1***@")
    .replace(SECRET_ASSIGNMENT, "$1$2$3***$3")
    .replace(KNOWN_TOKENS, "***")
    .replace(LONG_SECRETISH, "$1***$1");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const TOOLING_CONFIG = /(^|\/)(eslint|vitest|vite|jest|playwright|cypress|tailwind|postcss|tsup|webpack|rollup|babel|prettier|next|nuxt|svelte|astro|commitlint|lint-staged|stylelint|turbo|drizzle)\.config\.[cm]?[jt]s$/;

/** Build / lint / test tool configuration. It runs at development time, not in production. */
export function isToolingConfig(rel: string): boolean {
  return TOOLING_CONFIG.test(rel);
}
