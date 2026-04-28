import { Language } from "./types.js";

export interface ParsedImport {
  source: string;
  isRelative: boolean;
  isExternal: boolean;
}

const PATTERNS: Record<Language, RegExp[]> = {
  typescript: [
    /(?:import|export)\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
  ],
  javascript: [
    /(?:import|export)\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
  ],
  python: [
    /^import\s+([\w.]+)/gm,
    /^from\s+([\w.]+)\s+import/gm,
  ],
  go: [
    /import\s+(?:[\w]+\s+)?["']([\w./\-@]+)["']/g,
    /["']([\w./\-@]+\/[\w./\-@]+)["']/g,
  ],
  java: [
    /^import\s+([\w.]+);/gm,
  ],
  ruby: [
    /require(?:_relative)?\s+['"]([^'"]+)['"]/g,
  ],
  unknown: [],
};

export function parseImports(content: string, language: Language): ParsedImport[] {
  const patterns = PATTERNS[language] ?? [];
  const imports: ParsedImport[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const source = match[1];
      if (!source || seen.has(source)) continue;
      seen.add(source);
      imports.push({
        source,
        isRelative: source.startsWith("."),
        isExternal: isExternalImport(source, language),
      });
    }
  }

  return imports;
}

function isExternalImport(source: string, language: Language): boolean {
  if (source.startsWith(".") || source.startsWith("/")) return false;

  switch (language) {
    case "python":
      // stdlib modules — treat as internal
      const PYTHON_STDLIB = new Set([
        "os", "sys", "re", "json", "math", "time", "datetime", "collections",
        "itertools", "functools", "pathlib", "typing", "abc", "io", "logging",
        "threading", "subprocess", "hashlib", "base64", "urllib", "http",
        "asyncio", "contextlib", "copy", "enum", "dataclasses", "unittest",
      ]);
      const rootModule = source.split(".")[0];
      return !PYTHON_STDLIB.has(rootModule ?? "");
    case "go":
      return source.includes(".");
    case "java":
      return source.startsWith("com.") || source.startsWith("org.") || source.startsWith("io.");
    default:
      return !source.startsWith("@/") && !source.startsWith("~/");
  }
}
