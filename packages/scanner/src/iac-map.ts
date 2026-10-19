import type { Exposure, GraphEvidence, GraphNode } from "@trailmap/graph";
import { matchIacResource, getVendor, type Engine } from "./catalog.js";
import { ev, type GraphBuilder } from "./assemble.js";
import type { IacResource } from "./iac.js";

export interface IacMapContext {
  builder: GraphBuilder;
  /** Resolve deploy-time names (service name, container name, task family) to a code service node id. */
  resolveService(names: string[]): string | null;
}

export const INTERNET_ID = "internet";

type Attrs = Record<string, unknown>;

const isTf = (r: IacResource) => r.provider === "terraform";
const evKind = (r: IacResource) => (isTf(r) ? "terraform" : "cloudformation") as "terraform" | "cloudformation";
const nodeIdFor = (r: IacResource) => `${isTf(r) ? "tf" : "cfn"}:${r.address}`;

function get(r: IacResource, tf: string, cfn: string): unknown {
  return (r.attrs as Attrs)[isTf(r) ? tf : cfn];
}

function literal(v: unknown): string | undefined {
  if (typeof v === "string" && !v.startsWith("${") && !v.includes("${")) return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function truthy(v: unknown): boolean | undefined {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return undefined;
}

function blocks(v: unknown): Attrs[] {
  if (Array.isArray(v)) return v.filter((x): x is Attrs => !!x && typeof x === "object");
  if (v && typeof v === "object") return [v as Attrs];
  return [];
}

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  return [];
}

const PUBLIC_CIDRS = new Set(["0.0.0.0/0", "::/0"]);

const LB_TYPES_TF = new Set(["aws_lb", "aws_alb", "aws_elb", "aws_api_gateway_rest_api", "aws_apigatewayv2_api", "aws_cloudfront_distribution"]);
const LB_TYPES_CFN = new Set(["AWS::ElasticLoadBalancingV2::LoadBalancer", "AWS::ElasticLoadBalancing::LoadBalancer", "AWS::ApiGateway::RestApi", "AWS::ApiGatewayV2::Api", "AWS::CloudFront::Distribution"]);
const COMPUTE_TF = new Set(["aws_ecs_service", "aws_lambda_function", "aws_instance", "aws_apprunner_service", "google_cloud_run_service", "google_cloud_run_v2_service", "azurerm_linux_web_app", "azurerm_container_app"]);
const COMPUTE_CFN = new Set(["AWS::ECS::Service", "AWS::Lambda::Function", "AWS::EC2::Instance", "AWS::AppRunner::Service"]);
const INDIRECT_TF = new Set(["aws_ecs_task_definition", "aws_launch_template", "aws_launch_configuration"]);
const INDIRECT_CFN = new Set(["AWS::ECS::TaskDefinition", "AWS::EC2::LaunchTemplate"]);
const SG_TF = new Set(["aws_security_group"]);
const SG_CFN = new Set(["AWS::EC2::SecurityGroup"]);

const isLb = (r: IacResource) => (isTf(r) ? LB_TYPES_TF : LB_TYPES_CFN).has(r.type);
const isCompute = (r: IacResource) => (isTf(r) ? COMPUTE_TF : COMPUTE_CFN).has(r.type);
const isIndirect = (r: IacResource) => (isTf(r) ? INDIRECT_TF : INDIRECT_CFN).has(r.type);
const isSg = (r: IacResource) => (isTf(r) ? SG_TF : SG_CFN).has(r.type);
const isLambda = (r: IacResource) => r.type === "aws_lambda_function" || r.type === "AWS::Lambda::Function";

function engineFor(r: IacResource): Engine | null {
  const hintKeys = isTf(r)
    ? ["engine", "database_version", "engine_version"]
    : ["Engine", "EngineVersion"];
  const hint = hintKeys.map((k) => literal((r.attrs as Attrs)[k])).find(Boolean);
  return matchIacResource(isTf(r) ? "tf" : "cfn", r.type, hint);
}

function exposureRules(r: IacResource): Exposure[] {
  const out: Exposure[] = [];
  const push = (direction: "ingress" | "egress", cidr: string, port: number | null, protocol?: string) =>
    out.push({ direction, cidr, port, protocol, source: r.file, line: r.line });

  if (isTf(r)) {
    if (r.type === "aws_security_group") {
      for (const dir of ["ingress", "egress"] as const) {
        for (const b of blocks(get(r, dir, ""))) {
          const port = Number.isFinite(Number(b.from_port)) ? Number(b.from_port) : null;
          for (const cidr of [...strings(b.cidr_blocks), ...strings(b.ipv6_cidr_blocks)]) {
            if (PUBLIC_CIDRS.has(cidr)) push(dir, cidr, port, literal(b.protocol));
          }
        }
      }
    } else if (r.type === "aws_security_group_rule") {
      const dir = literal(get(r, "type", "")) === "egress" ? "egress" : "ingress";
      const port = Number.isFinite(Number(get(r, "from_port", ""))) ? Number(get(r, "from_port", "")) : null;
      for (const cidr of [...strings(get(r, "cidr_blocks", "")), ...strings(get(r, "ipv6_cidr_blocks", ""))]) {
        if (PUBLIC_CIDRS.has(cidr)) push(dir, cidr, port, literal(get(r, "protocol", "")));
      }
    } else if (r.type === "aws_vpc_security_group_ingress_rule" || r.type === "aws_vpc_security_group_egress_rule") {
      const dir = r.type.includes("egress") ? "egress" : "ingress";
      const cidr = literal(get(r, "cidr_ipv4", "")) ?? literal(get(r, "cidr_ipv6", ""));
      const port = Number.isFinite(Number(get(r, "from_port", ""))) ? Number(get(r, "from_port", "")) : null;
      if (cidr && PUBLIC_CIDRS.has(cidr)) push(dir, cidr, port, literal(get(r, "ip_protocol", "")));
    }
  } else if (r.type === "AWS::EC2::SecurityGroup") {
    for (const [key, dir] of [["SecurityGroupIngress", "ingress"], ["SecurityGroupEgress", "egress"]] as const) {
      for (const b of blocks(get(r, "", key))) {
        const cidr = literal(b.CidrIp) ?? literal(b.CidrIpv6);
        const port = Number.isFinite(Number(b.FromPort)) ? Number(b.FromPort) : null;
        if (cidr && PUBLIC_CIDRS.has(cidr)) push(dir, cidr, port, literal(b.IpProtocol));
      }
    }
  } else if (r.type === "AWS::EC2::SecurityGroupIngress" || r.type === "AWS::EC2::SecurityGroupEgress") {
    const cidr = literal(get(r, "", "CidrIp")) ?? literal(get(r, "", "CidrIpv6"));
    const port = Number.isFinite(Number(get(r, "", "FromPort"))) ? Number(get(r, "", "FromPort")) : null;
    if (cidr && PUBLIC_CIDRS.has(cidr)) push(r.type.endsWith("Ingress") ? "ingress" : "egress", cidr, port, literal(get(r, "", "IpProtocol")));
  }
  return out;
}

const addExposure = (node: GraphNode, exposures: Exposure[]) => {
  if (!exposures.length) return;
  node.exposure = [...(node.exposure ?? []), ...exposures];
  if (exposures.some((e) => e.direction === "ingress")) node.public = true;
};

export function mapIac(resources: IacResource[], ctx: IacMapContext): void {
  const { builder } = ctx;
  const byAddr = new Map(resources.map((r) => [`${r.provider}:${r.address}`, r]));
  const lookup = (from: IacResource, address: string) => byAddr.get(`${from.provider}:${address}`);
  const idOf = new Map<IacResource, string>();

  const provEvidence = (r: IacResource, detail: string) => [ev(evKind(r), r.file, detail, r.line)];
  const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".");

  const baseNode = (r: IacResource, type: GraphNode["type"], name: string): GraphNode => ({
    id: nodeIdFor(r),
    name,
    type,
    language: "unknown",
    port: null,
    endpoints: [],
    path: dirOf(r.file),
    iac: { provider: r.provider, resourceType: r.type, address: r.address },
    evidence: provEvidence(r, `${r.type} "${r.name}"`),
  });

  const displayName = (r: IacResource) =>
    literal(get(r, "name", "Name")) ?? literal(get(r, "identifier", "DBInstanceIdentifier")) ?? literal(get(r, "bucket", "BucketName")) ?? r.name;

  // 1. Nodes for engines, load balancers, compute, networks ---------------------------------
  for (const r of resources) {
    const engine = engineFor(r);
    if (engine) {
      const node = baseNode(r, engine.nodeType, displayName(r));
      node.engine = engine.id;
      const pub =
        truthy(get(r, "publicly_accessible", "PubliclyAccessible")) === true ||
        literal(get(r, "acl", "AccessControl")) === "public-read" ||
        literal(get(r, "acl", "AccessControl")) === "PublicRead";
      if (pub) {
        node.public = true;
        const port = Number.isFinite(Number(get(r, "port", "Port"))) ? Number(get(r, "port", "Port")) : null;
        node.exposure = [{ direction: "ingress", cidr: "0.0.0.0/0", port, source: r.file, line: r.line }];
      }
      builder.addNode(node);
      idOf.set(r, node.id);
      continue;
    }
    if (isLb(r)) {
      const scheme = literal(get(r, "", "Scheme"));
      const internal = isTf(r) ? truthy(get(r, "internal", "")) === true : scheme === "internal";
      const isApi = /api|cloudfront/i.test(r.type);
      const node = baseNode(r, "loadbalancer", displayName(r));
      if (!internal || isApi) {
        node.public = true;
        node.exposure = [{ direction: "ingress", cidr: "0.0.0.0/0", port: null, source: r.file, line: r.line }];
      }
      builder.addNode(node);
      idOf.set(r, node.id);
      continue;
    }
    if (isCompute(r)) {
      const taskDefText = JSON.stringify(r.attrs);
      const containerNames = [...taskDefText.matchAll(/\\?"name\\?":\s*\\?"([\w.-]+)\\?"/g)].map((m) => m[1]!);
      const names = [displayName(r), r.name, literal(get(r, "function_name", "FunctionName")), ...containerNames].filter((x): x is string => Boolean(x));
      const existing = ctx.resolveService(names);
      if (existing) {
        const n = builder.nodes.get(existing)!;
        n.iac = n.iac ?? { provider: r.provider, resourceType: r.type, address: r.address };
        n.evidence = [...(n.evidence ?? []), ...provEvidence(r, `deployed as ${r.type} "${r.name}"`)];
        idOf.set(r, existing);
      } else {
        const node = baseNode(r, isLambda(r) ? "function" : "service", displayName(r));
        builder.addNode(node);
        idOf.set(r, node.id);
      }
      continue;
    }
    if (r.type === "aws_vpc" || r.type === "AWS::EC2::VPC") {
      const node = baseNode(r, "network", displayName(r));
      builder.addNode(node);
      idOf.set(r, node.id);
    }
  }

  // 2. Subnets annotate their VPC ------------------------------------------------------------
  for (const r of resources) {
    if (r.type !== "aws_subnet" && r.type !== "AWS::EC2::Subnet") continue;
    const vpc = r.refs.map((a) => lookup(r, a)).find((x) => x && (x.type === "aws_vpc" || x.type === "AWS::EC2::VPC"));
    const vpcId = vpc ? idOf.get(vpc) : undefined;
    if (!vpcId) continue;
    const isPublic = truthy(get(r, "map_public_ip_on_launch", "MapPublicIpOnLaunch")) === true;
    const node = builder.nodes.get(vpcId)!;
    node.endpoints = [...node.endpoints, `subnet ${r.name} (${isPublic ? "public" : "private"})`];
  }

  // 3. Security group exposure: attach to what uses the group, else keep it as its own node ----
  const sgRules = new Map<IacResource, Exposure[]>();
  for (const r of resources) {
    const rules = exposureRules(r);
    if (!rules.length) continue;
    if (isSg(r)) {
      sgRules.set(r, [...(sgRules.get(r) ?? []), ...rules]);
    } else {
      // standalone rule resources point at their group
      const group = r.refs.map((a) => lookup(r, a)).find((x) => x && isSg(x));
      if (group) sgRules.set(group, [...(sgRules.get(group) ?? []), ...rules]);
    }
  }
  for (const [sg, rules] of sgRules) {
    const users = resources.filter((u) => !isSg(u) && u.refs.includes(sg.address) && idOf.has(u));
    const direct = users.filter((u) => isCompute(u) || isLb(u) || engineFor(u) !== null);
    // task definitions / launch templates carry the group on behalf of the service
    const viaIndirect = resources.filter((c) => isCompute(c) && idOf.has(c) && c.refs.some((a) => {
      const t = lookup(c, a);
      return t && isIndirect(t) && t.refs.includes(sg.address);
    }));
    const targets = [...new Set([...direct, ...viaIndirect])];
    if (targets.length) {
      for (const t of targets) addExposure(builder.nodes.get(idOf.get(t)!)!, rules.map((x) => ({ ...x })));
    } else {
      const node = baseNode(sg, "network", displayName(sg));
      addExposure(node, rules);
      builder.addNode(node);
      idOf.set(sg, node.id);
    }
  }

  // 4. Listeners: record their ports on the load balancer, map target groups to balancers ------
  const tgToLb = new Map<string, IacResource>();
  for (const r of resources) {
    const isListener = r.type === "aws_lb_listener" || r.type === "aws_alb_listener" || r.type === "AWS::ElasticLoadBalancingV2::Listener";
    if (!isListener) continue;
    const refTargets = r.refs.map((a) => lookup(r, a)).filter((x): x is IacResource => !!x);
    const lb = refTargets.find(isLb);
    if (!lb) continue;
    const port = literal(get(r, "port", "Port"));
    const proto = literal(get(r, "protocol", "Protocol"));
    const lbNode = builder.nodes.get(idOf.get(lb) ?? "");
    if (lbNode && port) {
      lbNode.endpoints = [...lbNode.endpoints, `listener :${port}${proto ? ` ${proto}` : ""}`];
      if (lbNode.public && lbNode.exposure) {
        for (const e of lbNode.exposure) if (e.port === null) e.port = Number(port);
      }
    }
    for (const tg of refTargets) if (tg.type.includes("TargetGroup") || tg.type.includes("target_group")) tgToLb.set(tg.address, lb);
  }

  /** Edge from a compute resource to a datastore, plus the cloud vendor that operates it. */
  const addEngineEdge = (fromId: string, toId: string, engine: Engine, evidence: GraphEvidence[]) => {
    builder.addEdge(fromId, toId, engine.edge, "iac-ref", evidence);
    const v = engine.vendor ? getVendor(engine.vendor) : undefined;
    if (v) {
      const vid = `vendor:${v.id}`;
      builder.addNode({ id: vid, name: v.name, type: "saas", language: "unknown", port: null, endpoints: [], path: "", vendor: v.id, evidence: [] });
      builder.addEdge(fromId, vid, "http", "iac-ref", evidence);
    }
  };

  // 5. Edges --------------------------------------------------------------------------------
  const anyPublicLb = [...idOf.entries()].some(([r, id]) => isLb(r) && builder.nodes.get(id)?.public);
  if (anyPublicLb) {
    builder.addNode({
      id: INTERNET_ID, name: "Internet", type: "network", language: "unknown", port: null, endpoints: [], path: "",
      public: true, evidence: [],
    });
  }
  for (const [r, id] of idOf) {
    if (isLb(r) && builder.nodes.get(id)?.public) {
      builder.addEdge(INTERNET_ID, id, "network", "iac-ref", provEvidence(r, `${r.type} "${r.name}" is internet-facing`));
    }
  }

  for (const c of resources) {
    const cid = idOf.get(c);
    if (!cid || !isCompute(c)) continue;
    const effective = new Set<string>(c.refs);
    for (const a of c.refs) {
      const t = lookup(c, a);
      if (t && isIndirect(t)) for (const x of t.refs) effective.add(x);
    }
    for (const a of effective) {
      const t = lookup(c, a);
      if (!t) continue;
      const engine = engineFor(t);
      const tid = idOf.get(t);
      if (engine && tid) addEngineEdge(cid, tid, engine, provEvidence(c, `${c.type} "${c.name}" references ${t.address}`));
      // load balancer in front of this service, directly or through a target group
      const lb = isLb(t) ? t : tgToLb.get(t.address);
      const lbId = lb ? idOf.get(lb) : undefined;
      if (lb && lbId) builder.addEdge(lbId, cid, "network", "iac-ref", provEvidence(c, `${lb.address} forwards to ${c.address}`));
    }
  }

  // API gateways / load balancers invoking a function
  for (const r of resources) {
    if (r.type !== "aws_lambda_permission" && r.type !== "aws_apigatewayv2_integration" && r.type !== "AWS::Lambda::Permission") continue;
    const targets = r.refs.map((a) => lookup(r, a)).filter((x): x is IacResource => !!x);
    const fn = targets.find(isLambda);
    const front = targets.find(isLb);
    const fnId = fn ? idOf.get(fn) : undefined;
    const frontId = front ? idOf.get(front) : undefined;
    if (fn && front && fnId && frontId) {
      builder.addEdge(frontId, fnId, "network", "iac-ref", provEvidence(r, `${front.address} invokes ${fn.address}`));
    }
  }

  // Event sources: a function consuming a queue
  for (const r of resources) {
    if (r.type !== "aws_lambda_event_source_mapping" && r.type !== "AWS::Lambda::EventSourceMapping") continue;
    const targets = r.refs.map((a) => lookup(r, a)).filter((x): x is IacResource => !!x);
    const fn = targets.find(isLambda);
    const source = targets.find((t) => engineFor(t) !== null);
    const fnId = fn ? idOf.get(fn) : undefined;
    const srcId = source ? idOf.get(source) : undefined;
    const engine = source ? engineFor(source) : null;
    if (fn && fnId && srcId && engine) {
      addEngineEdge(fnId, srcId, engine, provEvidence(r, `${fn.address} consumes ${source!.address}`));
    }
  }

}
