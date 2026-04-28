import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { GraphNode, GraphEdge } from "./types.js";

export interface InfraService {
  name: string;
  image?: string;
  port?: number;
  dependsOn?: string[];
  environment?: Record<string, string>;
}

export function parseDockerCompose(filePath: string): InfraService[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(content) as Record<string, unknown>;
    const services = (parsed?.services ?? {}) as Record<string, unknown>;
    const result: InfraService[] = [];

    for (const [name, svc] of Object.entries(services)) {
      const s = svc as Record<string, unknown>;
      const ports = (s.ports as string[] | undefined) ?? [];
      const firstPort = ports[0]?.toString().split(":").pop();
      const dependsOn = s.depends_on
        ? Array.isArray(s.depends_on)
          ? (s.depends_on as string[])
          : Object.keys(s.depends_on as Record<string, unknown>)
        : [];

      result.push({
        name,
        image: s.image as string | undefined,
        port: firstPort ? parseInt(firstPort, 10) : undefined,
        dependsOn,
        environment: (s.environment as Record<string, string>) ?? {},
      });
    }

    return result;
  } catch {
    return [];
  }
}

export function parseKubernetesManifest(filePath: string): InfraService[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const docs = yaml.loadAll(content) as Array<Record<string, unknown>>;
    const result: InfraService[] = [];

    for (const doc of docs) {
      if (!doc || typeof doc !== "object") continue;
      const kind = doc.kind as string;
      if (kind !== "Deployment" && kind !== "Service" && kind !== "StatefulSet") continue;

      const metadata = doc.metadata as Record<string, unknown>;
      const name = (metadata?.name as string) ?? "unknown";
      const spec = doc.spec as Record<string, unknown>;

      let port: number | undefined;
      if (kind === "Service") {
        const ports = (spec?.ports as Array<Record<string, unknown>>) ?? [];
        port = ports[0]?.port as number | undefined;
      }

      result.push({ name, port });
    }

    return result;
  } catch {
    return [];
  }
}

export function parseOpenApiSpec(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let parsed: Record<string, unknown>;

    if (filePath.endsWith(".json")) {
      parsed = JSON.parse(content);
    } else {
      parsed = yaml.load(content) as Record<string, unknown>;
    }

    const paths = (parsed?.paths ?? {}) as Record<string, unknown>;
    return Object.keys(paths);
  } catch {
    return [];
  }
}

export function isOpenApiFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return (
    base === "openapi.yaml" ||
    base === "openapi.json" ||
    base === "swagger.yaml" ||
    base === "swagger.json" ||
    base.includes("openapi") ||
    base.includes("swagger")
  );
}

export function isDockerCompose(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === "docker-compose.yml" || base === "docker-compose.yaml";
}

export function isKubernetesManifest(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const doc = yaml.load(content) as Record<string, unknown>;
    const kind = doc?.kind as string | undefined;
    const KUBE_KINDS = new Set([
      "Deployment", "Service", "StatefulSet", "DaemonSet",
      "ConfigMap", "Ingress", "Pod",
    ]);
    return KUBE_KINDS.has(kind ?? "");
  } catch {
    return false;
  }
}
