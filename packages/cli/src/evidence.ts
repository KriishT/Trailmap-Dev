import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getFramework, type Framework } from "@trailmap/frameworks";
import { dataFlows, doraRegisterAssistCsv, type DependencyGraph, type DataClass } from "@trailmap/graph";
import { collectVendors, vendorInventoryCsv } from "./vendors.js";

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

export interface EvidencePackOptions {
  dir: string;
  framework: string;
  outDir: string;
  preparedBy?: string;
  exclude?: string[];
}

export interface EvidencePackResult {
  outDir: string;
  files: string[];
  framework: Framework;
  graphHash: string;
}

const DATA_CLASSES: DataClass[] = ["PAN", "PHI", "PII", "CREDENTIALS"];

function dataFlowMarkdown(graph: DependencyGraph): string {
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const out: string[] = ["# Data flows", "", "Edges that carry a data class, with the code location that shows it.", ""];
  let any = false;
  for (const cls of DATA_CLASSES) {
    const edges = dataFlows(graph, cls);
    if (!edges.length) continue;
    any = true;
    out.push(`## ${cls}`, "", "| From | To | Certainty | Evidence |", "|---|---|---|---|");
    for (const e of edges) {
      const tag = e.dataClasses!.find((t) => t.class === cls)!;
      const ev = tag.evidence.find((x) => x.line) ?? tag.evidence[0];
      out.push(`| ${names.get(e.from) ?? e.from} | ${names.get(e.to) ?? e.to} | ${tag.certainty} | ${ev ? `${ev.source}${ev.line ? `:${ev.line}` : ""}` : ""} |`);
    }
    out.push("");
  }
  if (!any) out.push("No data classes were detected on any connection.", "");
  out.push("Certainty 'evidenced' means a specific code location shows the class; 'possible' means it is implied, for example by what a vendor typically processes.", "");
  return out.join("\n");
}

function evidenceAppendix(graph: DependencyGraph): string {
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const out = ["# Evidence appendix", "", "Every connection with the file and line it was derived from.", ""];
  for (const e of graph.edges) {
    out.push(`## ${names.get(e.from) ?? e.from} to ${names.get(e.to) ?? e.to} (${e.type}, ${e.confidence} confidence)`, "");
    for (const ev of e.evidence ?? []) {
      out.push(`- ${ev.kind}: ${ev.detail} (\`${ev.source}${ev.line ? `:${ev.line}` : ""}\`)`);
    }
    out.push("");
  }
  return out.join("\n");
}

function readme(fw: Framework, graph: DependencyGraph, files: string[]): string {
  const out = [
    `# ${fw.name} ${fw.version}: evidence pack`, "",
    `Repository: ${graph.meta.repo}`,
    `Scanned at: ${graph.meta.scanned_at}`,
    `Scanner: ${graph.meta.scannerVersion ?? "unknown"}`,
    `Graph hash (sha256): ${graph.meta.graphHash ?? "unknown"}`, "",
    fw.disclaimer, "",
    "## What this pack supports", "",
  ];
  for (const r of fw.requirements) {
    out.push(`### ${r.id}: ${r.title}`, "", r.summary, "", `Produced here: ${r.produces.join(", ")}`, "", `Verify: ${r.verify}`, "");
  }
  out.push("## Files", "", ...files.map((f) => `- ${f}`), "", "`manifest.json` lists the sha256 of every file so the pack can be checked later.", "");
  return out.join("\n");
}

/** Write a local evidence pack. Everything is derived from the working tree; nothing leaves the machine. */
export async function buildEvidencePack(opts: EvidencePackOptions): Promise<EvidencePackResult> {
  const fw = getFramework(opts.framework);
  if (!fw) throw new Error(`Unknown framework "${opts.framework}". Use pci, soc2 or dora.`);

  const { graph, rows } = await collectVendors({ dir: opts.dir, exclude: opts.exclude });
  const files: Record<string, string> = {
    "graph.json": JSON.stringify(graph, null, 2),
    "vendors.csv": vendorInventoryCsv(rows),
    "data-flows.md": dataFlowMarkdown(graph),
    "evidence-appendix.md": evidenceAppendix(graph),
  };
  if (fw.id === "dora") files["dora-register-assist.csv"] = doraRegisterAssistCsv(rows);
  files["README.md"] = readme(fw, graph, [...Object.keys(files), "README.md", "manifest.json"].sort());

  fs.mkdirSync(opts.outDir, { recursive: true });
  const manifestFiles: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(opts.outDir, name), content, "utf8");
    manifestFiles[name] = sha256(content);
  }
  const manifest = {
    framework: { id: fw.id, name: fw.name, version: fw.version },
    repository: graph.meta.repo,
    scannedAt: graph.meta.scanned_at,
    scannerVersion: graph.meta.scannerVersion,
    graphHash: graph.meta.graphHash,
    preparedBy: opts.preparedBy ?? null,
    requirements: fw.requirements.map((r) => ({ id: r.id, title: r.title, verify: r.verify })),
    disclaimer: fw.disclaimer,
    files: manifestFiles,
  };
  fs.writeFileSync(path.join(opts.outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  return { outDir: opts.outDir, files: [...Object.keys(files), "manifest.json"].sort(), framework: fw, graphHash: graph.meta.graphHash ?? "" };
}
