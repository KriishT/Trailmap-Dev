// Fails if anything a browser can download mentions a server-only secret.
// Run after `npm run build`. It scans apps/web/.next/static, which is what the browser receives.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../apps/web/.next/static", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const FORBIDDEN = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "SHARE_COOKIE_SECRET",
  "BEGIN RSA PRIVATE KEY",
  "BEGIN PRIVATE KEY",
  "TRAILMAP_LOCAL_SANDBOX",
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|css|html|json|map)$/.test(name)) yield p;
  }
}

let files = 0;
const hits = [];
for (const file of walk(ROOT)) {
  files++;
  const text = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${file}: ${needle}`);
}
if (files === 0) {
  console.error(`No files found under ${ROOT}. Build the web app first.`);
  process.exit(2);
}
if (hits.length) {
  console.error("Server-only secrets referenced in the client bundle:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`Client bundle clean: ${files} files scanned, none mention a server-only secret.`);
