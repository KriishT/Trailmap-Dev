import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as fs from "node:fs";
import * as path from "node:path";
import { scan } from "@trailmap/scanner";
import { renderHtml } from "./render-html.js";
import { collectVendors, renderVendorsTable, vendorInventoryCsv } from "./vendors.js";
import { buildEvidencePack } from "./evidence.js";
import { readPolicyText, renderDriftReport, runLocalCheck } from "./check.js";
import { remoteCheck, uploadSnapshot, type RemoteOptions } from "./remote.js";

const VERSION = "0.2.0";
const program = new Command();

program.name("trailmap").description("Architecture and data-flow evidence from your code and infrastructure").version(VERSION);

function remoteOptions(o: { apiUrl?: string; apiKey?: string; repoId?: string }): RemoteOptions {
  const apiUrl = o.apiUrl ?? process.env.TRAILMAP_API_URL ?? "https://app.trailmap.dev";
  const apiKey = o.apiKey ?? process.env.TRAILMAP_API_KEY;
  const repoId = o.repoId ?? process.env.TRAILMAP_REPO_ID;
  if (!apiKey || !repoId) throw new Error("TRAILMAP_API_KEY and TRAILMAP_REPO_ID (or --api-key / --repo-id) are required for remote commands");
  return { apiUrl, apiKey, repoId };
}

function fail(err: unknown): never {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

program
  .command("scan [directory]")
  .description("Scan a directory and generate an architecture map")
  .option("-o, --output <format>", "Output format: json | html | c4", "json")
  .option("--out-file <path>", "Write output to a file instead of stdout")
  .option("--include-libraries", "Include third-party library nodes in the graph", false)
  .option("--include-tests", "Treat test files as evidence", false)
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .option("--upload", "Send the graph (not the code) to Trailmap using an API key")
  .option("--commit <sha>", "Commit SHA to record with an upload")
  .option("--branch <name>", "Branch to record with an upload")
  .option("--api-url <url>", "Trailmap API base URL")
  .option("--api-key <key>", "API key (or TRAILMAP_API_KEY)")
  .option("--repo-id <id>", "Repository id in Trailmap (or TRAILMAP_REPO_ID)")
  .action(async (directory = ".", options) => {
    const targetDir = path.resolve(directory);
    if (!fs.existsSync(targetDir)) fail(`Directory not found: ${targetDir}`);

    const spinner = ora({ text: chalk.dim(`Scanning ${chalk.cyan(targetDir)}...`), color: "cyan", isEnabled: process.stderr.isTTY }).start();
    try {
      const graph = await scan({
        rootDir: targetDir, exclude: options.exclude, includeLibraries: options.includeLibraries, includeTests: options.includeTests,
      });
      spinner.succeed(
        chalk.green("Scan complete") +
          chalk.dim(` - ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.meta.total_files} files`)
      );

      if (options.upload) {
        const r = await uploadSnapshot({ ...remoteOptions(options), graph, commitSha: options.commit, branch: options.branch });
        console.error(chalk.green(`Uploaded snapshot ${r.snapshotId} (graph hash ${r.graphHash.slice(0, 12)})`));
        return;
      }

      let output: string;
      switch (options.output) {
        case "html": output = renderHtml(graph); break;
        case "c4": output = renderC4(graph); break;
        default: output = JSON.stringify(graph, null, 2);
      }
      if (options.outFile) {
        fs.writeFileSync(path.resolve(options.outFile), output, "utf-8");
        console.error(chalk.dim(`Written to ${chalk.cyan(path.resolve(options.outFile))}`));
      } else {
        console.log(output);
      }
    } catch (err) {
      spinner.fail(chalk.red("Scan failed"));
      fail(err);
    }
  });

program
  .command("vendors [directory]")
  .description("List the third-party vendors and subprocessors your code uses, with the evidence")
  .option("--json", "Print JSON")
  .option("--csv", "Print CSV")
  .option("--include-tests", "Treat test files as evidence", false)
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .action(async (directory = ".", options) => {
    try {
      const { rows } = await collectVendors({ dir: path.resolve(directory), exclude: options.exclude, includeTests: options.includeTests });
      if (options.json) console.log(JSON.stringify(rows, null, 2));
      else if (options.csv) process.stdout.write(vendorInventoryCsv(rows));
      else console.log(renderVendorsTable(rows));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("evidence [directory]")
  .description("Write a local evidence pack for a framework (pci, soc2 or dora)")
  .requiredOption("-f, --framework <id>", "pci | soc2 | dora")
  .option("-o, --out-dir <dir>", "Where to write the pack", "trailmap-evidence")
  .option("--prepared-by <name>", "Name to record in the pack")
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .action(async (directory = ".", options) => {
    try {
      const r = await buildEvidencePack({
        dir: path.resolve(directory), framework: options.framework, outDir: path.resolve(options.outDir),
        preparedBy: options.preparedBy, exclude: options.exclude,
      });
      console.log(`Wrote ${r.files.length} files for ${r.framework.name} ${r.framework.version} to ${r.outDir}`);
      console.log(`Graph hash: ${r.graphHash}`);
      console.log(r.framework.disclaimer);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("check [directory]")
  .description("Check a change for architecture and compliance-scope drift")
  .option("--base <ref>", "Git ref to compare against (local mode)", "origin/main")
  .option("--policy <file>", "Policy file (default: .trailmap.yml)")
  .option("--remote", "Compare with the baseline stored in Trailmap instead of a git ref")
  .option("--pr <number>", "Pull request number (remote mode)")
  .option("--head-sha <sha>", "Head commit SHA (remote mode)")
  .option("--api-url <url>", "Trailmap API base URL")
  .option("--api-key <key>", "API key (or TRAILMAP_API_KEY)")
  .option("--repo-id <id>", "Repository id in Trailmap (or TRAILMAP_REPO_ID)")
  .option("--json", "Print JSON")
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .action(async (directory = ".", options) => {
    try {
      const dir = path.resolve(directory);
      let conclusion: string;
      let report: string;
      let payload: unknown;

      if (options.remote) {
        const prNumber = Number(options.pr ?? process.env.TRAILMAP_PR_NUMBER);
        const headSha = options.headSha ?? process.env.GITHUB_SHA;
        if (!Number.isInteger(prNumber) || !headSha) throw new Error("--pr and --head-sha are required with --remote");
        const graph = await scan({ rootDir: dir, repoName: path.basename(dir), exclude: options.exclude });
        const v = await remoteCheck({ ...remoteOptions(options), graph, prNumber, headSha, policy: readPolicyText(dir, options.policy) });
        conclusion = v.conclusion;
        payload = v;
        report = renderDriftReport({ findings: v.findings as never, ignored: new Array(v.ignored), conclusion: v.conclusion, summary: v.summary }, v.policyErrors);
      } else {
        const r = await runLocalCheck({ dir, base: options.base, policyFile: options.policy, exclude: options.exclude });
        conclusion = r.drift.conclusion;
        payload = { ...r.drift, policyErrors: r.policyErrors };
        report = renderDriftReport(r.drift, r.policyErrors);
      }

      console.log(options.json ? JSON.stringify(payload, null, 2) : report);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```\n" + report + "```\n");
      // The policy decides: only a 'failure' conclusion fails the job.
      process.exit(conclusion === "failure" ? 1 : 0);
    } catch (err) {
      fail(err);
    }
  });

program.parse();

function renderC4(graph: Awaited<ReturnType<typeof scan>>): string {
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
  const lines: string[] = ["workspace {", "  model {"];
  for (const node of graph.nodes) {
    lines.push(`    ${id(node.id)} = softwareSystem "${node.name.replace(/"/g, "'")}" {`, `      tags "${node.type}" "${node.language}"`, "    }");
  }
  lines.push("");
  for (const edge of graph.edges) {
    lines.push(`    ${id(edge.from)} -> ${id(edge.to)} "${edge.type}" {`, `      tags "${edge.confidence}"`, "    }");
  }
  lines.push("  }", "  views {", "    systemLandscape {", "      include *", "    }", "  }", "}");
  return lines.join("\n");
}
