import { z } from "zod";
import pci from "./data/pci-dss.json" with { type: "json" };
import soc2 from "./data/soc2.json" with { type: "json" };
import dora from "./data/dora.json" with { type: "json" };

/** What a requirement can be supported with. Each maps to a sheet or export in the product. */
export const ARTIFACTS = [
  "system-diagram",
  "network-diagram",
  "data-flow-diagram",
  "data-class-table",
  "vendor-inventory",
  "dora-register-assist",
  "scope-confirmation",
  "revision-log",
  "attestation-trail",
  "evidence-appendix",
] as const;
export type Artifact = (typeof ARTIFACTS)[number];

export const SHEETS = ["system", "network", "data-flow", "vendors", "revisions"] as const;
export type Sheet = (typeof SHEETS)[number];

const requirementSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  produces: z.array(z.enum(ARTIFACTS)).min(1),
  sheets: z.array(z.enum(SHEETS)).min(1),
  /** What the person must check themselves; shown next to every generated artifact. */
  verify: z.string().min(1),
});

export const frameworkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  disclaimer: z.string().min(1),
  requirements: z.array(requirementSchema).min(1),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Framework = z.infer<typeof frameworkSchema>;

export const FRAMEWORKS: Framework[] = [pci, soc2, dora].map((f) => frameworkSchema.parse(f));

/** Look a framework up by id or alias (`pci`, `soc-2`). */
export function getFramework(idOrAlias: string): Framework | undefined {
  const key = idOrAlias.trim().toLowerCase();
  return FRAMEWORKS.find((f) => f.id === key || f.aliases.includes(key));
}

export function listFrameworks(): Array<Pick<Framework, "id" | "name" | "version">> {
  return FRAMEWORKS.map(({ id, name, version }) => ({ id, name, version }));
}

/** Every sheet needed to cover the given frameworks, in a stable order. */
export function sheetsFor(frameworkIds: string[]): Sheet[] {
  const wanted = new Set<Sheet>();
  for (const id of frameworkIds) {
    for (const req of getFramework(id)?.requirements ?? []) req.sheets.forEach((s) => wanted.add(s));
  }
  return SHEETS.filter((s) => wanted.has(s));
}

/** Phrases that would claim certification or approval. Used by tests to keep copy honest. */
export const FORBIDDEN_CLAIMS = [/\bcertified\b/i, /\bauditor[- ]approved\b/i, /\bguarantees? compliance\b/i, /\bfully compliant\b/i];
