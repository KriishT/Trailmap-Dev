import * as yaml from "js-yaml";
import { z } from "zod";

export const DRIFT_RULES = [
  "new_vendor",
  "data_class_to_vendor",
  "scope_boundary_crossing",
  "public_exposure",
  "datastore_change",
  "low_confidence_in_scope",
] as const;
export type DriftRule = (typeof DRIFT_RULES)[number];

export const policySchema = z.object({
  version: z.literal(1).default(1),
  /** Check-run conclusion when drift is found. */
  on_drift: z.enum(["neutral", "failure"]).default("neutral"),
  /** Rules default to enabled; set one to false to turn it off. */
  rules: z.record(z.enum(DRIFT_RULES), z.boolean()).default({}),
  /** Scopes defined in the repository, by node id. They are merged with scopes defined in the app. */
  scopes: z
    .array(z.object({ name: z.string().min(1), nodes: z.array(z.string()).default([]) }))
    .default([]),
  /** Node ids or finding keys that are accepted risk and should not be reported. */
  ignore: z.array(z.string()).default([]),
  /** Frameworks the repo reports against: soc2, pci-dss, dora. */
  frameworks: z.array(z.string()).default([]),
});

export type Policy = z.infer<typeof policySchema>;

export const defaultPolicy = (): Policy => policySchema.parse({});

export interface ParsedPolicy {
  policy: Policy;
  /** Human-readable problems. When non-empty the default policy is used. */
  errors: string[];
}

/** Parse a `.trailmap.yml`. An invalid file never crashes a check: it falls back to defaults and says why. */
export function parsePolicy(text: string | null | undefined): ParsedPolicy {
  if (!text || !text.trim()) return { policy: defaultPolicy(), errors: [] };
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (err) {
    return { policy: defaultPolicy(), errors: [`.trailmap.yml is not valid YAML: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`] };
  }
  const result = policySchema.safeParse(raw ?? {});
  if (!result.success) {
    return {
      policy: defaultPolicy(),
      errors: result.error.issues.map((i) => `.trailmap.yml ${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { policy: result.data, errors: [] };
}

/** Settings made in the app override the file, field by field. */
export function mergePolicy(fromFile: Policy, fromApp: Partial<Policy> | null | undefined): Policy {
  if (!fromApp) return fromFile;
  return {
    ...fromFile,
    ...(fromApp.on_drift ? { on_drift: fromApp.on_drift } : {}),
    rules: { ...fromFile.rules, ...(fromApp.rules ?? {}) },
    scopes: [...fromFile.scopes, ...(fromApp.scopes ?? [])],
    ignore: [...new Set([...fromFile.ignore, ...(fromApp.ignore ?? [])])],
    frameworks: fromApp.frameworks?.length ? fromApp.frameworks : fromFile.frameworks,
  };
}

export const ruleEnabled = (policy: Policy, rule: DriftRule): boolean => policy.rules[rule] !== false;
