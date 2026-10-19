export interface CodeownersRule {
  pattern: string;
  owners: string[];
  regex: RegExp;
}

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

export function parseCodeowners(content: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...owners] = line.split(/\s+/).filter(Boolean);
    if (!pattern || owners.length === 0) continue;
    rules.push({ pattern, owners, regex: patternToRegex(pattern) });
  }
  return rules;
}

/** The last matching rule wins, as on GitHub. */
export function matchOwnersForPath(filePath: string, rules: CodeownersRule[]): string[] {
  const normalized = normalizePath(filePath);
  let matched: string[] = [];
  for (const rule of rules) if (rule.regex.test(normalized)) matched = rule.owners;
  return matched;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  let normalized = normalizePath(pattern);
  const directoryOnly = normalized.endsWith("/");
  if (directoryOnly) normalized = normalized.slice(0, -1);

  const doubleStar = "\u0000DOUBLE\u0000";
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStar)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(doubleStar, "g"), ".*")
    .replace(/\?/g, ".");

  const tail = directoryOnly ? "(?:/.*)?$" : "(?:/.*)?$";
  return new RegExp(anchored ? `^${escaped}${tail}` : `^(?:.*/)?${escaped}${tail}`);
}
