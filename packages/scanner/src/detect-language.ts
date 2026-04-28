import { Language } from "./types.js";
import * as fs from "fs";
import * as path from "path";

const LANGUAGE_INDICATORS: Record<Language, string[]> = {
  typescript: ["tsconfig.json", "*.ts", "*.tsx"],
  javascript: ["package.json", "*.js", "*.mjs", "*.cjs"],
  python: ["requirements.txt", "pyproject.toml", "setup.py", "*.py"],
  go: ["go.mod", "go.sum", "*.go"],
  java: ["pom.xml", "build.gradle", "*.java"],
  ruby: ["Gemfile", "*.rb"],
  unknown: [],
};

export function detectLanguage(dirPath: string): Language {
  try {
    const files = fs.readdirSync(dirPath);
    const fileSet = new Set(files.map((f) => f.toLowerCase()));

    if (fileSet.has("tsconfig.json")) return "typescript";
    if (fileSet.has("go.mod")) return "go";
    if (fileSet.has("pom.xml") || fileSet.has("build.gradle")) return "java";
    if (
      fileSet.has("requirements.txt") ||
      fileSet.has("pyproject.toml") ||
      fileSet.has("setup.py")
    )
      return "python";
    if (fileSet.has("gemfile")) return "ruby";
    if (fileSet.has("package.json")) return "javascript";

    // Fall back to file extension scan
    const extensions = files.map((f) => path.extname(f).toLowerCase());
    if (extensions.includes(".ts") || extensions.includes(".tsx"))
      return "typescript";
    if (extensions.includes(".go")) return "go";
    if (extensions.includes(".py")) return "python";
    if (extensions.includes(".java")) return "java";
    if (extensions.includes(".rb")) return "ruby";
    if (extensions.includes(".js")) return "javascript";
  } catch {
    // ignore read errors
  }
  return "unknown";
}

export function detectLanguageFromFile(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, Language> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
  };
  return map[ext] ?? "unknown";
}
