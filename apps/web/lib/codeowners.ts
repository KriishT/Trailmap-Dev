export interface CodeownersRule {
  pattern: string;
  owners: string[];
  regex: RegExp;
}

export function parseCodeowners(content: string): CodeownersRule[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split(/\s+/).filter(Boolean);
      const [pattern, ...owners] = parts;
      if (!pattern || owners.length === 0) return null;

      return {
        pattern,
        owners,
        regex: codeownersPatternToRegex(pattern),
      } satisfies CodeownersRule;
    })
    .filter((rule): rule is CodeownersRule => !!rule);
}

export function matchOwnersForPath(path: string, rules: CodeownersRule[]): string[] {
  const normalized = normalizePath(path);
  let matchedOwners: string[] = [];

  for (const rule of rules) {
    if (rule.regex.test(normalized)) {
      matchedOwners = rule.owners;
    }
  }

  return matchedOwners;
}

function codeownersPatternToRegex(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  let normalized = normalizePath(pattern);

  const directoryOnly = normalized.endsWith("/");
  if (directoryOnly) normalized = normalized.slice(0, -1);

  const placeholder = "__DOUBLE_STAR__";
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, placeholder)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(placeholder, "g"), ".*")
    .replace(/\?/g, ".");

  let source: string;

  if (anchored) {
    source = `^${escaped}${directoryOnly ? "(?:/.*)?$" : "$"}`;
  } else if (normalized.includes("/")) {
    source = `^(?:.*/)?${escaped}${directoryOnly ? "(?:/.*)?$" : "$"}`;
  } else {
    source = `^(?:.*/)?${escaped}${directoryOnly ? "(?:/.*)?$" : "$"}`;
  }

  return new RegExp(source);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
