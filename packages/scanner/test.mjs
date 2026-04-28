import { scan } from "./dist/index.mjs";

const graph = await scan({ rootDir: "C:\\tmp\\papermark" });
console.log("Nodes:", graph.nodes.map(n => `${n.name} [${n.type}] fw=${n.framework ?? "-"}`));
console.log("Edges:", graph.edges.map(e => `${e.from} --${e.type}--> ${e.to} (${e.confidence})`));
console.log("Stack:", graph.nodes[0]?.techStack);