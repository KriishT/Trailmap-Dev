import * as fs from "node:fs";
import { buildDemoData } from "../lib/demo/build.ts";
const d = await buildDemoData();
fs.writeFileSync(new URL("../lib/demo/demo-data.json", import.meta.url), JSON.stringify(d, null, 2) + "\n");
for (const r of d.revisions) console.log(r.label, r.graph.nodes.length, "nodes", r.graph.edges.length, "edges", r.graph.meta.graphHash?.slice(0, 10));
console.log("PR", d.pullRequest.graph.nodes.length, d.pullRequest.graph.edges.length);
