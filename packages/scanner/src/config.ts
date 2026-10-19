import * as yaml from "js-yaml";

export interface ConfigValue {
  /** Flattened key, e.g. "ConnectionStrings:Default" or "spring.datasource.url". */
  key: string;
  value: string;
  file: string;
  line: number;
}

const CONFIG_FILE_RE = [
  /(^|\/)appsettings(\.[\w-]+)?\.json$/i,
  /(^|\/)application(-[\w]+)?\.(properties|ya?ml)$/i,
  /(^|\/)bootstrap\.ya?ml$/i,
  /(^|\/)config\/database\.ya?ml$/i,
  /(^|\/)\.env(\.[a-z0-9_-]+)?$/i,
];

export function isConfigFile(rel: string): boolean {
  return CONFIG_FILE_RE.some((re) => re.test(rel));
}

function lineOf(content: string, needle: string): number {
  const idx = content.indexOf(needle);
  if (idx === -1) return 1;
  let line = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function flatten(prefix: string, value: unknown, sep: string, out: Array<[string, string]>) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(prefix ? `${prefix}${sep}${i}` : String(i), v, sep, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(prefix ? `${prefix}${sep}${k}` : k, v, sep, out);
    }
    return;
  }
  out.push([prefix, String(value)]);
}

export function parseConfig(rel: string, content: string): ConfigValue[] {
  const base = rel.split("/").pop() ?? rel;
  const pairs: Array<[string, string]> = [];

  if (base.endsWith(".json")) {
    try {
      flatten("", JSON.parse(content), ":", pairs);
    } catch {
      return [];
    }
  } else if (base.endsWith(".properties")) {
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
      if (m) pairs.push([m[1]!, m[2]!.trim()]);
    }
  } else if (/\.ya?ml$/i.test(base)) {
    try {
      const docs = yaml.loadAll(content);
      for (const doc of docs) flatten("", doc, ".", pairs);
    } catch {
      return [];
    }
  } else {
    // .env style
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) pairs.push([m[1]!, m[2]!.trim().replace(/^["']|["']$/g, "")]);
    }
  }

  return pairs.map(([key, value]) => {
    const last = key.split(/[:.]/).pop() ?? key;
    const needle = base.endsWith(".json") ? `"${last}"` : last;
    return { key, value, file: rel, line: lineOf(content, needle) };
  });
}

/** Normalise a key so "A:B:C", "a.b.c" and "A__B__C" compare equal. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/__|:|\./g, ".").replace(/[-_]/g, "");
}

/** Engines implied by a config key even when the value is not a URI (Spring, Rails, ...). */
export function engineFromConfigKey(key: string, value: string): string | null {
  const k = key.toLowerCase();
  if (/(^|\.)adapter$/.test(k)) {
    const v = value.toLowerCase();
    if (v.startsWith("postgres")) return "postgres";
    if (v.startsWith("mysql")) return "mysql";
    if (v.startsWith("sqlite")) return "sqlite";
    if (v.startsWith("sqlserver")) return "mssql";
  }
  if (/kafka.*bootstrap/.test(k)) return "kafka";
  if (/spring\.(data\.)?redis/.test(k)) return "redis";
  if (/spring\.rabbitmq/.test(k)) return "rabbitmq";
  if (/spring\.data\.mongodb/.test(k)) return "mongodb";
  return null;
}

/** ADO.NET style connection strings: "Host=db;Database=app;Username=u" etc. */
export function engineFromAdoString(value: string): string | null {
  const v = value.toLowerCase();
  if (!v.includes("=") || !v.includes(";")) return null;
  if (/(^|;)\s*host\s*=/.test(v) && /(^|;)\s*(username|user id)\s*=/.test(v) && !/trusted_connection/.test(v)) return "postgres";
  if (/(^|;)\s*server\s*=/.test(v) && /(database|initial catalog)\s*=/.test(v)) return v.includes("port=3306") ? "mysql" : "mssql";
  return null;
}
