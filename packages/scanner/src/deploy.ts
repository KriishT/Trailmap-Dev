import * as yaml from "js-yaml";

/**
 * Deployment descriptors (docker-compose, Kubernetes, Helm) reduced to a common shape.
 * They tell us which env vars a service is configured with, what image/ports it runs, and
 * which other services it is wired to.
 */
export interface DeployUnit {
  kind: "compose" | "k8s" | "helm";
  name: string;
  file: string;
  line?: number;
  image?: string;
  /** Repo-relative directory the image is built from (compose `build`). */
  buildContext?: string;
  ports: number[];
  env: Array<{ name: string; value?: string; line?: number }>;
  dependsOn: string[];
  /** Other names this unit answers to on the network (k8s Service names, container_name). */
  aliases: string[];
  /** Reachable from outside the cluster (Ingress, LoadBalancer / NodePort Service). */
  public: boolean;
}

function lineOf(content: string, needle: string, from = 0): number | undefined {
  const idx = content.indexOf(needle, from);
  if (idx === -1) return undefined;
  let line = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}

function joinRel(base: string, p: string): string {
  const parts = (base ? base.split("/") : []).concat(p.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// ---- Dockerfile ----------------------------------------------------------------------

export interface DockerfileInfo {
  ports: number[];
  env: Array<{ name: string; value?: string; line?: number }>;
}

export function parseDockerfile(content: string): DockerfileInfo {
  const ports: number[] = [];
  const env: DockerfileInfo["env"] = [];
  content.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    const expose = /^EXPOSE\s+(.+)$/i.exec(line);
    if (expose) for (const p of expose[1]!.split(/\s+/)) { const n = Number.parseInt(p, 10); if (n) ports.push(n); }
    const e = /^ENV\s+([A-Za-z_][A-Za-z0-9_]*)[=\s]\s*(.*)$/i.exec(line);
    if (e) env.push({ name: e[1]!, value: e[2]!.replace(/^["']|["']$/g, ""), line: idx + 1 });
    const cmdPort = /--port[= ](\d{2,5})|-p (\d{2,5})/.exec(line);
    if (cmdPort && /^(CMD|ENTRYPOINT)/i.test(line)) ports.push(Number.parseInt(cmdPort[1] ?? cmdPort[2]!, 10));
  });
  return { ports, env };
}

// ---- docker-compose ------------------------------------------------------------------

function envEntries(raw: unknown, content: string): DeployUnit["env"] {
  const out: DeployUnit["env"] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = str(item);
      if (!s) continue;
      const eq = s.indexOf("=");
      const name = eq === -1 ? s : s.slice(0, eq);
      out.push({ name, value: eq === -1 ? undefined : s.slice(eq + 1), line: lineOf(content, name) });
    }
  } else {
    for (const [name, v] of Object.entries(asObj(raw))) {
      out.push({ name, value: v === null || v === undefined ? undefined : String(v), line: lineOf(content, name) });
    }
  }
  return out;
}

function portNumbers(raw: unknown): number[] {
  const out: number[] = [];
  for (const p of asArr(raw)) {
    if (typeof p === "number") { out.push(p); continue; }
    if (typeof p === "string") {
      const container = p.split(":").pop()?.replace(/\/\w+$/, "");
      const n = Number.parseInt(container ?? "", 10);
      if (n) out.push(n);
      continue;
    }
    const o = asObj(p);
    const target = typeof o.target === "number" ? o.target : Number.parseInt(String(o.target ?? ""), 10);
    if (target) out.push(target);
  }
  return out;
}

export function isComposeFile(rel: string): boolean {
  return /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(rel);
}

export function parseCompose(rel: string, content: string): DeployUnit[] {
  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch {
    return [];
  }
  const services = asObj(asObj(doc).services);
  const units: DeployUnit[] = [];
  for (const [name, defRaw] of Object.entries(services)) {
    const def = asObj(defRaw);
    const build = def.build;
    const context = typeof build === "string" ? build : str(asObj(build).context);
    const dockerfile = typeof build === "object" && build !== null ? str(asObj(build).dockerfile) : undefined;
    const dependsRaw = def.depends_on;
    const dependsOn = Array.isArray(dependsRaw) ? dependsRaw.map(String) : Object.keys(asObj(dependsRaw));
    const aliases = [str(def.container_name), str(def.hostname)].filter((x): x is string => Boolean(x));
    const exposed = asArr(def.expose).map((e) => Number.parseInt(String(e), 10)).filter(Boolean);
    units.push({
      kind: "compose",
      name,
      file: rel,
      line: lineOf(content, `${name}:`),
      image: str(def.image),
      // With an explicit Dockerfile path, the service lives where that Dockerfile lives.
      buildContext: dockerfile
        ? dirOf(joinRel(joinRel(dirOf(rel), context ?? ""), dockerfile))
        : context ? joinRel(dirOf(rel), context) : undefined,
      ports: [...portNumbers(def.ports), ...exposed],
      env: envEntries(def.environment, content),
      dependsOn,
      aliases,
      public: false,
    });
  }
  return units;
}

// ---- Kubernetes ----------------------------------------------------------------------

const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod", "ReplicaSet"]);

export function looksLikeKubernetes(content: string): boolean {
  return /^\s*apiVersion:/m.test(content) && /^\s*kind:\s*\w+/m.test(content);
}

interface K8sService {
  name: string;
  selector: Record<string, string>;
  type: string;
}

export function parseKubernetes(rel: string, content: string, kind: "k8s" | "helm" = "k8s"): DeployUnit[] {
  let docs: unknown[];
  try {
    docs = yaml.loadAll(content);
  } catch {
    return [];
  }
  const units: Array<DeployUnit & { labels: Record<string, string> }> = [];
  const services: K8sService[] = [];
  const ingressBackends = new Set<string>();

  for (const docRaw of docs) {
    const doc = asObj(docRaw);
    const k = str(doc.kind);
    if (!k) continue;
    const meta = asObj(doc.metadata);
    const name = str(meta.name);
    if (!name) continue;

    if (WORKLOAD_KINDS.has(k)) {
      const spec = asObj(doc.spec);
      let podSpec: Record<string, unknown>;
      if (k === "CronJob") podSpec = asObj(asObj(asObj(asObj(spec.jobTemplate).spec).template).spec);
      else if (k === "Pod") podSpec = spec;
      else podSpec = asObj(asObj(spec.template).spec);
      const templateMeta = asObj(asObj(spec.template).metadata);
      const labels = Object.fromEntries(
        Object.entries({ ...asObj(meta.labels), ...asObj(templateMeta.labels) }).map(([a, b]) => [a, String(b)])
      );
      const containers = asArr(podSpec.containers).map(asObj);
      const main = containers[0] ?? {};
      const env: DeployUnit["env"] = [];
      const ports: number[] = [];
      for (const c of containers) {
        for (const e of asArr(c.env).map(asObj)) {
          const en = str(e.name);
          if (en) env.push({ name: en, value: str(e.value), line: lineOf(content, `name: ${en}`) });
        }
        for (const p of asArr(c.ports).map(asObj)) {
          const cp = Number(p.containerPort);
          if (cp) ports.push(cp);
        }
      }
      units.push({
        kind, name, file: rel, line: lineOf(content, `name: ${name}`), image: str(main.image),
        ports, env, dependsOn: [], aliases: [], public: false, labels,
      });
    } else if (k === "Service") {
      const spec = asObj(doc.spec);
      services.push({
        name,
        selector: Object.fromEntries(Object.entries(asObj(spec.selector)).map(([a, b]) => [a, String(b)])),
        type: str(spec.type) ?? "ClusterIP",
      });
    } else if (k === "Ingress") {
      const spec = asObj(doc.spec);
      for (const rule of asArr(spec.rules).map(asObj)) {
        for (const p of asArr(asObj(rule.http).paths).map(asObj)) {
          const be = asObj(p.backend);
          const svc = str(asObj(be.service).name) ?? str(be.serviceName);
          if (svc) ingressBackends.add(svc);
        }
      }
      const defaultSvc = str(asObj(asObj(spec.defaultBackend).service).name);
      if (defaultSvc) ingressBackends.add(defaultSvc);
    }
  }

  for (const svc of services) {
    const matches = units.filter(
      (u) => Object.keys(svc.selector).length > 0 && Object.entries(svc.selector).every(([a, b]) => u.labels[a] === b)
    );
    const exposedPublicly = svc.type === "LoadBalancer" || svc.type === "NodePort" || ingressBackends.has(svc.name);
    // A Service with no matching workload (common in Helm renders) aliases the workload with the same name.
    const targets = matches.length ? matches : units.filter((u) => u.name === svc.name);
    for (const u of targets) {
      if (u.name !== svc.name) u.aliases.push(svc.name);
      if (exposedPublicly) u.public = true;
    }
  }

  return units.map(({ labels: _labels, ...u }) => {
    void _labels;
    return u;
  });
}

// ---- Helm (best effort) ----------------------------------------------------------------

export interface HelmChart {
  /** Directory of the chart, repo-relative. */
  dir: string;
  name: string;
  values: unknown;
  templates: Array<{ file: string; content: string }>;
}

function lookup(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

/**
 * Render a Helm template well enough to read workloads, env vars and services.
 * Control lines ({{- if }}, {{- range }}, {{- end }}, toYaml, include ...) are dropped, `.Values.*`,
 * `.Release.Name` and `.Chart.Name` are substituted, and anything else becomes a neutral placeholder.
 * Conditionals are assumed enabled. Real Helm rendering is out of scope, so results are best effort.
 */
export function renderHelmTemplate(text: string, chart: { name: string; values: unknown }): string {
  const release = chart.name;
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    // A line that is nothing but one control directive ({{- if ... }}, {{- end }}, toYaml ...) is dropped.
    const groups = raw.match(/\{\{/g)?.length ?? 0;
    if (groups === 1 && /^\s*\{\{-?\s*(?:(?:if|else|end|range|with|define|template|include|toYaml)\b|\/\*|\$)[^]*\}\}\s*$/.test(raw)) {
      continue;
    }
    const replaced = raw.replace(/\{\{-?\s*(.*?)\s*-?\}\}/g, (_m, expr: string) => {
      const e = expr.replace(/\|.*$/, "").trim();
      let m = /^\.Values\.([\w.]+)$/.exec(e);
      if (m) {
        const v = lookup(chart.values, m[1]!.split("."));
        return v === undefined || v === null || typeof v === "object" ? "value" : String(v);
      }
      m = /^default\s+(\S+)\s+\.Values\.([\w.]+)$/.exec(e);
      if (m) {
        const v = lookup(chart.values, m[2]!.split("."));
        return v === undefined ? m[1]!.replace(/^["']|["']$/g, "") : String(v);
      }
      if (/^\.Release\.Name$/.test(e) || /^\.Chart\.Name$/.test(e)) return release;
      if (/^include\s+"[^"]*(fullname|name)"/.test(e)) return release;
      return "value";
    });
    lines.push(replaced);
  }
  return lines.join("\n");
}

export function parseHelmChart(chart: HelmChart): DeployUnit[] {
  const units: DeployUnit[] = [];
  for (const t of chart.templates) {
    const rendered = renderHelmTemplate(t.content, chart);
    if (!looksLikeKubernetes(rendered)) continue;
    units.push(...parseKubernetes(t.file, rendered, "helm"));
  }
  return units;
}
