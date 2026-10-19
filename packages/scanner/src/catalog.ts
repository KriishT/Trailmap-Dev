import vendorsFile from "./data/vendors.json" with { type: "json" };
import enginesFile from "./data/engines.json" with { type: "json" };
import type { DataClass } from "@trailmap/graph";
import type { Lang } from "./tokenize.js";

export type Ecosystem = "npm" | "python" | "go" | "java" | "cs" | "ruby";
export type ManifestEcosystem = "npm" | "pypi" | "go" | "maven" | "nuget" | "gems";

export interface CallRule {
  class: DataClass;
  ids: string[];
  /** If present, one of these identifiers must appear within the call's arguments. */
  withArgs?: string[];
}

export interface Vendor {
  id: string;
  name: string;
  category: string;
  website: string;
  data: DataClass[];
  hosts: string[];
  envVars: string[];
  match: Partial<Record<Ecosystem, string[]>>;
  manifest: Partial<Record<ManifestEcosystem, string[]>>;
  constants: string[];
  calls: CallRule[];
}

export interface Engine {
  id: string;
  name: string;
  nodeType: "database" | "queue" | "storage";
  edge: "database" | "queue" | "storage";
  uris: string[];
  images: string[];
  envVars: string[];
  match: Partial<Record<Ecosystem, string[]>>;
  manifest: Partial<Record<ManifestEcosystem, string[]>>;
  tf: string[];
  cfn: string[];
  /** Cloud vendor that operates this engine, when it is a managed cloud service. */
  vendor?: string;
}

export type Entity =
  | { kind: "vendor"; id: string; vendor: Vendor }
  | { kind: "engine"; id: string; engine: Engine };

export const VENDORS = vendorsFile.vendors as unknown as Vendor[];
export const ENGINES = enginesFile.engines as unknown as Engine[];

const vendorById = new Map(VENDORS.map((v) => [v.id, v]));
const engineById = new Map(ENGINES.map((e) => [e.id, e]));

export const getVendor = (id: string) => vendorById.get(id);
export const getEngine = (id: string) => engineById.get(id);

export function ecosystemForLang(lang: Lang): Ecosystem {
  switch (lang) {
    case "js": return "npm";
    case "py": return "python";
    case "go": return "go";
    case "java": return "java";
    case "cs": return "cs";
    case "rb": return "ruby";
  }
}

interface PrefixEntry {
  prefix: string;
  entity: Entity;
}

function entitiesIn(): Entity[] {
  return [
    ...VENDORS.map((vendor): Entity => ({ kind: "vendor", id: vendor.id, vendor })),
    ...ENGINES.map((engine): Entity => ({ kind: "engine", id: engine.id, engine })),
  ];
}

const matchIndex: Record<Ecosystem, PrefixEntry[]> = { npm: [], python: [], go: [], java: [], cs: [], ruby: [] };
const manifestIndex: Record<ManifestEcosystem, Map<string, Entity>> = {
  npm: new Map(), pypi: new Map(), go: new Map(), maven: new Map(), nuget: new Map(), gems: new Map(),
};
const hostIndex: Array<{ host: string; entity: Entity }> = [];
const envIndex = new Map<string, Entity>();
const uriIndex: Array<{ scheme: string; entity: Entity }> = [];

for (const entity of entitiesIn()) {
  const src = entity.kind === "vendor" ? entity.vendor : entity.engine;
  for (const eco of Object.keys(matchIndex) as Ecosystem[]) {
    for (const prefix of src.match[eco] ?? []) matchIndex[eco].push({ prefix, entity });
  }
  for (const eco of Object.keys(manifestIndex) as ManifestEcosystem[]) {
    for (const name of src.manifest[eco] ?? []) manifestIndex[eco].set(name.toLowerCase(), entity);
  }
  if (entity.kind === "vendor") {
    for (const host of entity.vendor.hosts) hostIndex.push({ host, entity });
  } else {
    for (const scheme of entity.engine.uris) uriIndex.push({ scheme, entity });
  }
  for (const name of src.envVars) {
    // First definition wins so generic names stay with the most specific owner.
    if (!envIndex.has(name)) envIndex.set(name, entity);
  }
}
// Longest prefix first, so "aws-sdk/client-s3" style specifics beat shorter generic ones.
for (const eco of Object.keys(matchIndex) as Ecosystem[]) {
  matchIndex[eco].sort((a, b) => b.prefix.length - a.prefix.length);
}
hostIndex.sort((a, b) => b.host.length - a.host.length);
uriIndex.sort((a, b) => b.scheme.length - a.scheme.length);

function prefixMatches(eco: Ecosystem, spec: string, prefix: string): boolean {
  if (spec === prefix) return true;
  switch (eco) {
    case "npm":
    case "go":
      return spec.startsWith(prefix + "/");
    case "python":
    case "java":
    case "cs":
      return spec.startsWith(prefix + ".");
    case "ruby":
      return spec.startsWith(prefix + "/");
  }
}

/** Resolve an import specifier (as written in source) to a vendor or engine. */
export function matchImport(lang: Lang, spec: string): Entity | null {
  const eco = ecosystemForLang(lang);
  for (const { prefix, entity } of matchIndex[eco]) {
    if (prefixMatches(eco, spec, prefix)) return entity;
  }
  return null;
}

/** Resolve a dependency name from a manifest (package.json, requirements.txt, pom.xml ...). */
export function matchManifestDep(eco: ManifestEcosystem, name: string): Entity | null {
  return manifestIndex[eco].get(name.toLowerCase()) ?? null;
}

/** Resolve an outbound hostname to a vendor (exact or subdomain match). */
export function matchHost(host: string): Entity | null {
  const h = host.toLowerCase();
  for (const { host: known, entity } of hostIndex) {
    if (h === known || h.endsWith("." + known)) return entity;
  }
  return null;
}

/** Resolve an environment variable name that a service reads or is configured with. */
export function matchEnv(name: string): Entity | null {
  return envIndex.get(name) ?? null;
}

/** Resolve a connection string / URI by its scheme. */
export function matchUri(value: string): Entity | null {
  const v = value.trim().toLowerCase();
  for (const { scheme, entity } of uriIndex) {
    if (v.startsWith(scheme)) return entity;
  }
  return null;
}

/** Resolve a container image reference such as "postgres:15-alpine" to an engine. */
export function matchImage(image: string): Engine | null {
  const repo = (image.split("@")[0] ?? "").split(":")[0] ?? "";
  const last = repo.split("/").pop()?.toLowerCase() ?? "";
  if (!last) return null;
  for (const engine of ENGINES) {
    for (const fragment of engine.images) {
      if (last === fragment || last.includes(fragment)) return engine;
    }
  }
  return null;
}

/** Terraform / CloudFormation resource type (optionally with an engine hint) to an engine. */
export function matchIacResource(
  provider: "tf" | "cfn",
  resourceType: string,
  hint?: string
): Engine | null {
  const h = hint?.toLowerCase();
  let typeOnly: Engine | null = null;
  for (const engine of ENGINES) {
    for (const entry of engine[provider]) {
      // "aws_db_instance:postgres" or "AWS::RDS::DBInstance:postgres": the optional hint follows a single colon.
      const parts = /^(.+?[^:])(?::([A-Za-z0-9_.-]+))?$/.exec(entry);
      const type = parts?.[1];
      const wanted = parts?.[2];
      if (type !== resourceType) continue;
      if (wanted && h && h.includes(wanted.toLowerCase())) return engine;
      if (!wanted) typeOnly = typeOnly ?? engine;
    }
  }
  return typeOnly;
}
