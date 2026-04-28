import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import { scan } from "@trailmap/scanner";
import { renderHtml } from "./render-html.js";

const program = new Command();

program
  .name("trailmap")
  .description("Auto-generate architecture maps from your codebase")
  .version("0.1.0");

program
  .command("scan [directory]")
  .description("Scan a directory and generate an architecture map")
  .option("-o, --output <format>", "Output format: json | html | c4", "json")
  .option("--out-file <path>", "Write output to a file instead of stdout")
  .option("--include-libraries", "Include external library nodes in the graph", false)
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .action(async (directory = ".", options) => {
    const targetDir = path.resolve(directory);

    if (!fs.existsSync(targetDir)) {
      console.error(chalk.red(`x Directory not found: ${targetDir}`));
      process.exit(1);
    }

    const spinner = ora({
      text: chalk.dim(`Scanning ${chalk.cyan(targetDir)}...`),
      color: "cyan",
    }).start();

    try {
      const graph = await scan({
        rootDir: targetDir,
        exclude: options.exclude,
        includeLibraries: options.includeLibraries,
      });

      spinner.succeed(
        chalk.green("Scan complete") +
          chalk.dim(
            ` - ${graph.nodes.length} services, ${graph.edges.length} edges, ${graph.meta.total_files} files`
          )
      );

      let output: string;

      switch (options.output) {
        case "html":
          output = renderHtml(graph);
          break;
        case "c4":
          output = renderC4(graph);
          break;
        default:
          output = JSON.stringify(graph, null, 2);
      }

      if (options.outFile) {
        const outPath = path.resolve(options.outFile);
        fs.writeFileSync(outPath, output, "utf-8");
        console.log(chalk.dim(`\nWritten to ${chalk.cyan(outPath)}`));
      } else {
        console.log(output);
      }

      if (options.output !== "json") return;

      console.error("\n" + chalk.bold("Summary"));
      console.error(chalk.dim("-".repeat(40)));
      console.error(
        chalk.dim("Services: ") + chalk.white(graph.nodes.filter((node) => node.type === "service").length)
      );
      console.error(
        chalk.dim("Databases: ") + chalk.white(graph.nodes.filter((node) => node.type === "database").length)
      );
      console.error(
        chalk.dim("Edges: ") + chalk.white(graph.edges.length)
      );
      console.error(chalk.dim("\nLanguages:"));
      for (const [lang, count] of Object.entries(graph.meta.language_breakdown)) {
        console.error(`  ${chalk.cyan(lang)}: ${count}`);
      }
    } catch (err) {
      spinner.fail(chalk.red("Scan failed"));
      console.error(chalk.red(String(err)));
      process.exit(1);
    }
  });

program
  .command("version")
  .description("Print version")
  .action(() => {
    console.log("0.1.0");
  });

program.parse();

function renderC4(graph: ReturnType<typeof scan> extends Promise<infer T> ? T : never): string {
  const lines: string[] = [
    "workspace {",
    "  model {",
  ];

  for (const node of graph.nodes) {
    const sanitized = node.id.replace(/-/g, "_");
    lines.push(`    ${sanitized} = softwareSystem "${node.name}" {`);
    lines.push(`      tags "${node.type}" "${node.language}"`);
    lines.push("    }");
  }

  lines.push("");
  for (const edge of graph.edges) {
    const from = edge.from.replace(/-/g, "_");
    const to = edge.to.replace(/-/g, "_");
    lines.push(`    ${from} -> ${to} "${edge.type}" {`);
    lines.push(`      tags "${edge.confidence}"`);
    lines.push("    }");
  }

  lines.push("  }", "  views {", "    systemLandscape {", '      include *', "    }", "  }", "}");
  return lines.join("\n");
}
