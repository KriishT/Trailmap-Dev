import * as yaml from "js-yaml";
import { parse as parseHcl } from "@cdktf/hcl2json";

/**
 * Infrastructure-as-code resources (Terraform, CloudFormation) in one normalised shape.
 * `refs` lists the addresses of other resources this one references, which is how we
 * connect load balancers to services and services to the datastores they are given.
 */
export interface IacResource {
  provider: "terraform" | "cloudformation";
  /** terraform: aws_db_instance; cloudformation: AWS::RDS::DBInstance */
  type: string;
  /** terraform: label; cloudformation: logical id */
  name: string;
  /** terraform: aws_db_instance.main; cloudformation: logical id */
  address: string;
  file: string;
  line: number;
  /** Resource arguments (terraform block / cloudformation Properties). */
  attrs: Record<string, unknown>;
  refs: string[];
}

function lineOfRegex(content: string, re: RegExp): number {
  const m = re.exec(content);
  if (!m) return 1;
  let line = 1;
  for (let i = 0; i < m.index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function parseTerraform(rel: string, content: string): Promise<IacResource[]> {
  let doc: Record<string, unknown>;
  try {
    doc = (await parseHcl(rel, content)) as Record<string, unknown>;
  } catch {
    return [];
  }
  const resources = (doc.resource ?? {}) as Record<string, Record<string, unknown[]>>;
  const out: IacResource[] = [];
  for (const [type, byName] of Object.entries(resources)) {
    for (const [name, blocks] of Object.entries(byName)) {
      const attrs = (Array.isArray(blocks) ? blocks[0] : blocks) as Record<string, unknown>;
      out.push({
        provider: "terraform",
        type,
        name,
        address: `${type}.${name}`,
        file: rel,
        line: lineOfRegex(content, new RegExp(`resource\\s+"${escapeRe(type)}"\\s+"${escapeRe(name)}"`)),
        attrs: attrs ?? {},
        refs: [],
      });
    }
  }
  return out;
}

const CFN_TAGS = [
  "Ref", "Sub", "GetAtt", "Join", "Select", "Split", "If", "Equals", "Not", "And", "Or", "FindInMap",
  "Base64", "GetAZs", "ImportValue", "Cidr", "Condition", "Transform",
];

function cfnSchema(): yaml.Schema {
  const types: yaml.Type[] = [];
  for (const tag of CFN_TAGS) {
    const fn = tag === "Ref" || tag === "Condition" ? tag : `Fn::${tag}`;
    for (const kind of ["scalar", "sequence", "mapping"] as const) {
      types.push(
        new yaml.Type(`!${tag}`, {
          kind,
          construct: (data: unknown) => {
            if (tag === "GetAtt" && typeof data === "string") return { [fn]: data.split(".") };
            return { [fn]: data };
          },
        })
      );
    }
  }
  return yaml.DEFAULT_SCHEMA.extend(types);
}

export function parseCloudFormation(rel: string, content: string): IacResource[] {
  let doc: unknown;
  try {
    doc = rel.endsWith(".json") ? JSON.parse(content) : yaml.load(content, { schema: cfnSchema() });
  } catch {
    return [];
  }
  const resources = (doc as { Resources?: Record<string, { Type?: string; Properties?: Record<string, unknown> }> } | null)?.Resources;
  if (!resources || typeof resources !== "object") return [];
  const out: IacResource[] = [];
  for (const [logicalId, def] of Object.entries(resources)) {
    if (!def || typeof def.Type !== "string" || !def.Type.includes("::")) continue;
    out.push({
      provider: "cloudformation",
      type: def.Type,
      name: logicalId,
      address: logicalId,
      file: rel,
      line: lineOfRegex(content, new RegExp(`^\\s*"?${escapeRe(logicalId)}"?\\s*:`, "m")),
      attrs: def.Properties ?? {},
      refs: [],
    });
  }
  return out;
}

export function looksLikeCloudFormation(content: string): boolean {
  return /AWSTemplateFormatVersion|^\s*Resources\s*:|"Resources"\s*:/m.test(content) && /AWS::[A-Za-z0-9]+::/.test(content);
}

/** Fill in `refs` for every resource by looking for the other resources' addresses in its arguments. */
export function linkReferences(resources: IacResource[]): void {
  const stringified = new Map<IacResource, string>();
  for (const r of resources) stringified.set(r, JSON.stringify(r.attrs));
  for (const r of resources) {
    const text = stringified.get(r)!;
    const refs = new Set<string>();
    for (const other of resources) {
      if (other === r || other.provider !== r.provider) continue;
      if (r.provider === "terraform") {
        if (new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(other.address)}([^A-Za-z0-9_-]|$)`).test(text)) refs.add(other.address);
      } else {
        const id = escapeRe(other.name);
        if (
          new RegExp(`"Ref":"${id}"`).test(text) ||
          new RegExp(`"Fn::GetAtt":\\["${id}"`).test(text) ||
          new RegExp(`\\$\\{${id}[.}]`).test(text) ||
          new RegExp(`"DependsOn":(\\[[^\\]]*)?"${id}"`).test(text)
        ) refs.add(other.address);
      }
    }
    r.refs = [...refs].sort();
  }
}
