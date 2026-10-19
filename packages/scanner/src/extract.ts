import type { Lang, Token } from "./tokenize.js";
import { VENDORS } from "./catalog.js";

/**
 * Facts found in source code, with the line they were found on. Everything here comes from
 * real code tokens: comments and regex literals never reach this module.
 */
export interface ImportSignal {
  k: "import";
  spec: string;
  /** Extra specifiers worth trying (Python `from a import b` also tries `a.b`). */
  also: string[];
  line: number;
  bindings: string[];
  /** True when the import is used for its side effects only, or when usage cannot be judged. */
  alwaysUsed: boolean;
  /** Token index range of the whole statement, used to ignore it when counting usages. */
  start: number;
  end: number;
}
export interface EnvSignal {
  k: "env";
  name: string;
  line: number;
}
export interface HttpSignal {
  k: "http";
  url: string;
  line: number;
  /** True when the URL only sits in a constant or option, not directly in a client call. */
  weak: boolean;
}
export interface UriSignal {
  k: "uri";
  value: string;
  line: number;
}
export interface ListenSignal {
  k: "listen";
  line: number;
  port?: number;
}
export interface CallSignal {
  k: "call";
  id: string;
  line: number;
  /** Identifiers and string values inside the call's argument list. */
  args: string[];
}
export interface BotoSignal {
  k: "boto";
  service: string;
  line: number;
}

export type Signal =
  | ImportSignal
  | EnvSignal
  | HttpSignal
  | UriSignal
  | ListenSignal
  | CallSignal
  | BotoSignal;

const CALL_IDS = new Set<string>(VENDORS.flatMap((v) => v.calls.flatMap((c) => c.ids)));

const CLIENT_IDS = new Set([
  "fetch", "axios", "got", "ky", "request", "requests", "httpx", "aiohttp", "urlopen", "urlretrieve",
  "NewRequest", "NewRequestWithContext", "Get", "Post", "Put", "Patch", "Delete", "Head",
  "get", "post", "put", "patch", "delete", "head", "HttpClient", "HttpRequest", "HttpRequestMessage",
  "WebClient", "RestTemplate", "RestClient", "URI", "Uri", "HTTParty", "Faraday", "Net", "superagent",
  "needle", "undici", "XMLHttpRequest", "open", "send", "exchange", "retrieve", "uri",
]);
const WEAK_URL_NAMES = /(url|uri|endpoint|host|base|origin|api)$/i;

const isClientId = (id: string) =>
  CLIENT_IDS.has(id) || /http|client|axios|fetch|request|rest/i.test(id);

function tokenIsUrl(t: Token | undefined): string | null {
  if (!t || (t.t !== "str" && t.t !== "tmpl")) return null;
  const v = t.v;
  if (!/^https?:\/\//i.test(v)) return null;
  // For templates, keep only the literal prefix; reject if a placeholder sits inside the host.
  if (t.t === "tmpl") {
    const cut = v.indexOf("${");
    const prefix = cut === -1 ? v : v.slice(0, cut);
    const hostPart = prefix.replace(/^https?:\/\//i, "");
    if (cut !== -1 && !hostPart.includes("/") && !hostPart.includes(":")) return null;
    return prefix;
  }
  return v;
}

export function extractSignals(tokens: Token[], lang: Lang): Signal[] {
  const out: Signal[] = [];
  const n = tokens.length;
  const at = (i: number) => tokens[i];
  const is = (i: number, v: string) => tokens[i]?.v === v && tokens[i]?.t !== "str" && tokens[i]?.t !== "tmpl";
  const isId = (i: number, v?: string) => tokens[i]?.t === "id" && (v === undefined || tokens[i]!.v === v);
  const isStr = (i: number) => tokens[i]?.t === "str" || tokens[i]?.t === "tmpl";

  // ---- imports -----------------------------------------------------------------------
  for (let i = 0; i < n; i++) {
    const tk = tokens[i]!;
    if (tk.t !== "id") continue;

    if (lang === "js") {
      if (tk.v === "import") {
        if (isId(i + 1, "type") && !is(i + 2, "from") && !is(i + 2, ",")) continue; // type-only
        if (isStr(i + 1)) {
          out.push({ k: "import", spec: at(i + 1)!.v, also: [], line: tk.line, bindings: [], alwaysUsed: true, start: i, end: i + 1 });
          continue;
        }
        if (is(i + 1, "(") && isStr(i + 2)) {
          out.push({ k: "import", spec: at(i + 2)!.v, also: [], line: tk.line, bindings: [], alwaysUsed: true, start: i, end: i + 3 });
          continue;
        }
        if (is(i + 1, ".") && isId(i + 2, "meta")) continue; // import.meta
        // import a, { b as c } from "x"
        const bindings: string[] = [];
        let j = i + 1;
        let guard = 0;
        while (j < n && guard++ < 400 && !isId(j, "from") && !is(j, ";")) {
          if (isId(j) && !isId(j, "as") && !isId(j, "type")) {
            // `x as y` binds y; `{ a as b }`: skip the left side
            if (isId(j + 1, "as")) { j += 2; continue; }
            bindings.push(at(j)!.v);
          }
          j++;
        }
        if (isId(j, "from") && isStr(j + 1)) {
          out.push({ k: "import", spec: at(j + 1)!.v, also: [], line: tk.line, bindings, alwaysUsed: false, start: i, end: j + 1 });
          i = j + 1;
        }
        continue;
      }
      if (tk.v === "export" && (is(i + 1, "{") || is(i + 1, "*"))) {
        let j = i + 1;
        let guard = 0;
        while (j < n && guard++ < 400 && !isId(j, "from") && !is(j, ";")) j++;
        if (isId(j, "from") && isStr(j + 1)) {
          out.push({ k: "import", spec: at(j + 1)!.v, also: [], line: tk.line, bindings: [], alwaysUsed: true, start: i, end: j + 1 });
          i = j + 1;
        }
        continue;
      }
      if ((tk.v === "require") && is(i + 1, "(") && isStr(i + 2) && is(i + 3, ")")) {
        const bindings: string[] = [];
        if (is(i - 1, "=")) {
          if (isId(i - 2)) bindings.push(at(i - 2)!.v);
          else if (is(i - 2, "}")) {
            for (let j = i - 3; j >= 0 && !is(j, "{"); j--) if (isId(j) && (is(j - 1, "{") || is(j - 1, ",") || is(j - 1, ":"))) bindings.push(at(j)!.v);
          }
        }
        out.push({ k: "import", spec: at(i + 2)!.v, also: [], line: tk.line, bindings, alwaysUsed: bindings.length === 0, start: Math.max(0, i - 6), end: i + 3 });
        continue;
      }
    }

    if (lang === "py") {
      const firstOnLine = i === 0 || tokens[i - 1]!.line < tk.line || is(i - 1, ";");
      if (firstOnLine && tk.v === "import") {
        let j = i + 1;
        let guard = 0;
        while (j < n && guard++ < 200 && (tokens[j]!.line === tk.line || is(j - 1, ","))) {
          if (!isId(j)) { j++; continue; }
          let spec = at(j)!.v;
          j++;
          while (is(j, ".") && isId(j + 1)) { spec += "." + at(j + 1)!.v; j += 2; }
          let alias: string | undefined;
          if (isId(j, "as") && isId(j + 1)) { alias = at(j + 1)!.v; j += 2; }
          out.push({ k: "import", spec, also: [], line: tk.line, bindings: [alias ?? spec.split(".")[0]!], alwaysUsed: false, start: i, end: j - 1 });
          if (is(j, ",")) j++;
        }
        i = j - 1;
        continue;
      }
      if (firstOnLine && tk.v === "from") {
        let j = i + 1;
        let spec = "";
        while (is(j, ".")) { spec += "."; j++; }
        while (isId(j) && !isId(j, "import")) {
          spec += at(j)!.v;
          j++;
          if (is(j, ".")) { spec += "."; j++; }
        }
        if (!isId(j, "import")) continue;
        j++;
        const bindings: string[] = [];
        const also: string[] = [];
        let depth = 0;
        let guard = 0;
        while (j < n && guard++ < 300) {
          const t2 = tokens[j]!;
          if (is(j, "(")) depth++;
          else if (is(j, ")")) { depth--; if (depth <= 0) { j++; break; } }
          else if (t2.line !== tk.line && depth === 0 && !is(j - 1, ",") && !is(j - 1, "\\")) break;
          else if (isId(j) && !isId(j, "as")) {
            if (isId(j + 1, "as") && isId(j + 2)) { bindings.push(at(j + 2)!.v); also.push(`${spec}.${t2.v}`); j += 3; continue; }
            bindings.push(t2.v);
            also.push(`${spec}.${t2.v}`);
          } else if (is(j, "*")) { bindings.push("*"); }
          j++;
        }
        if (!spec.startsWith(".")) {
          out.push({ k: "import", spec, also, line: tk.line, bindings, alwaysUsed: bindings.includes("*"), start: i, end: j - 1 });
        }
        i = j - 1;
        continue;
      }
    }

    if (lang === "go" && tk.v === "import") {
      const push = (str: Token, alias?: string) =>
        out.push({ k: "import", spec: str.v, also: [], line: str.line, bindings: alias ? [alias] : [], alwaysUsed: true, start: i, end: i });
      if (is(i + 1, "(")) {
        let j = i + 2;
        while (j < n && !is(j, ")")) {
          if (isStr(j)) { push(at(j)!); j++; continue; }
          if ((isId(j) || is(j, ".")) && isStr(j + 1)) { push(at(j + 1)!, at(j)!.v); j += 2; continue; }
          j++;
        }
        i = j;
      } else if (isStr(i + 1)) push(at(i + 1)!);
      else if ((isId(i + 1) || is(i + 1, ".")) && isStr(i + 2)) push(at(i + 2)!, at(i + 1)!.v);
      continue;
    }

    if ((lang === "java") && tk.v === "import") {
      let j = i + 1;
      if (isId(j, "static")) j++;
      let spec = "";
      while (j < n && (isId(j) || is(j, ".") || is(j, "*")) && (tokens[j]!.line === tk.line)) { spec += at(j)!.v; j++; }
      if (spec) out.push({ k: "import", spec: spec.replace(/\.\*$/, ""), also: [], line: tk.line, bindings: [], alwaysUsed: true, start: i, end: j });
      i = j;
      continue;
    }

    if (lang === "cs" && tk.v === "using") {
      let j = i + 1;
      if (is(j, "(") || isId(j, "var")) continue;
      if (isId(j, "static")) j++;
      if (isId(j) && is(j + 1, "=")) j += 2; // alias
      let spec = "";
      while (j < n && (isId(j) || is(j, ".")) && tokens[j]!.line === tk.line) { spec += at(j)!.v; j++; }
      if (spec && is(j, ";")) out.push({ k: "import", spec, also: [], line: tk.line, bindings: [], alwaysUsed: true, start: i, end: j });
      i = j;
      continue;
    }

    if (lang === "rb" && (tk.v === "require" || tk.v === "require_relative" || tk.v === "autoload")) {
      if (tk.v === "require_relative") continue;
      const argAt = is(i + 1, "(") ? i + 2 : i + 1;
      if (isStr(argAt) && tokens[argAt]!.line === tk.line) {
        out.push({ k: "import", spec: at(argAt)!.v, also: [], line: tk.line, bindings: [], alwaysUsed: true, start: i, end: argAt });
      }
      continue;
    }
  }

  // ---- environment reads, calls, urls, listen ----------------------------------------
  for (let i = 0; i < n; i++) {
    const tk = tokens[i]!;

    // JS / TS
    if (lang === "js" && tk.t === "id") {
      if (tk.v === "process" && is(i + 1, ".") && isId(i + 2, "env")) {
        if (is(i + 3, ".") && isId(i + 4)) out.push({ k: "env", name: at(i + 4)!.v, line: tk.line });
        else if (is(i + 3, "[") && isStr(i + 4)) out.push({ k: "env", name: at(i + 4)!.v, line: tk.line });
        else if (is(i - 1, "=") && is(i - 2, "}")) {
          // const { A, B: renamed = "x" } = process.env
          const names: EnvSignal[] = [];
          for (let j = i - 3; j >= 0 && !is(j, "{"); j--) {
            if (isId(j) && (is(j - 1, "{") || is(j - 1, ","))) names.push({ k: "env", name: at(j)!.v, line: tk.line });
          }
          out.push(...names.reverse());
        }
      } else if (tk.v === "import" && is(i + 1, ".") && isId(i + 2, "meta") && is(i + 3, ".") && isId(i + 4, "env") && is(i + 5, ".") && isId(i + 6)) {
        out.push({ k: "env", name: at(i + 6)!.v, line: tk.line });
      } else if ((tk.v === "Bun" || tk.v === "Deno") && is(i + 1, ".") && isId(i + 2, "env")) {
        if (is(i + 3, ".") && isId(i + 4, "get") && is(i + 5, "(") && isStr(i + 6)) out.push({ k: "env", name: at(i + 6)!.v, line: tk.line });
        else if (is(i + 3, ".") && isId(i + 4)) out.push({ k: "env", name: at(i + 4)!.v, line: tk.line });
      }
      if (tk.v === "listen" && is(i - 1, ".") && is(i + 1, "(")) {
        const port = tokens[i + 2]?.t === "num" ? Number.parseInt(tokens[i + 2]!.v, 10) : undefined;
        out.push({ k: "listen", line: tk.line, ...(port ? { port } : {}) });
      }
    }

    // Python
    if (lang === "py" && tk.t === "id") {
      if (tk.v === "os" && is(i + 1, ".") && isId(i + 2, "environ")) {
        if (is(i + 3, "[") && isStr(i + 4)) out.push({ k: "env", name: at(i + 4)!.v, line: tk.line });
        else if (is(i + 3, ".") && (isId(i + 4, "get") || isId(i + 4, "pop")) && is(i + 5, "(") && isStr(i + 6)) out.push({ k: "env", name: at(i + 6)!.v, line: tk.line });
      } else if (tk.v === "os" && is(i + 1, ".") && isId(i + 2, "getenv") && is(i + 3, "(") && isStr(i + 4)) {
        out.push({ k: "env", name: at(i + 4)!.v, line: tk.line });
      } else if (tk.v === "environ" && !is(i - 1, ".") && is(i + 1, "[") && isStr(i + 2)) {
        out.push({ k: "env", name: at(i + 2)!.v, line: tk.line });
      } else if (tk.v === "getenv" && !is(i - 1, ".") && is(i + 1, "(") && isStr(i + 2)) {
        out.push({ k: "env", name: at(i + 2)!.v, line: tk.line });
      }
      if ((tk.v === "client" || tk.v === "resource") && is(i - 1, ".") && is(i + 1, "(") && isStr(i + 2)) {
        out.push({ k: "boto", service: at(i + 2)!.v.toLowerCase(), line: tk.line });
      }
      if ((tk.v === "run" && is(i - 1, ".") && (isId(i - 2, "uvicorn") || isId(i - 2, "app") || isId(i - 2, "server"))) || (tk.v === "FastAPI" && is(i + 1, "(")) || (tk.v === "Flask" && is(i + 1, "("))) {
        let port: number | undefined;
        for (let j = i + 1; j < Math.min(n, i + 30) && !is(j, ")"); j++) {
          if (isId(j, "port") && is(j + 1, "=") && tokens[j + 2]?.t === "num") port = Number.parseInt(tokens[j + 2]!.v, 10);
        }
        out.push({ k: "listen", line: tk.line, ...(port ? { port } : {}) });
      }
    }

    // Go
    if (lang === "go" && tk.t === "id") {
      if (tk.v === "os" && is(i + 1, ".") && (isId(i + 2, "Getenv") || isId(i + 2, "LookupEnv")) && is(i + 3, "(") && isStr(i + 4)) {
        out.push({ k: "env", name: at(i + 4)!.v, line: tk.line });
      }
      if ((tk.v === "ListenAndServe" || tk.v === "ListenAndServeTLS" || tk.v === "Listen") && is(i + 1, "(")) {
        const m = isStr(i + 2) ? /:(\d{2,5})$/.exec(at(i + 2)!.v) : null;
        out.push({ k: "listen", line: tk.line, ...(m ? { port: Number.parseInt(m[1]!, 10) } : {}) });
      }
    }

    // Java / Kotlin
    if (lang === "java" && tk.t === "id") {
      if (tk.v === "System" && is(i + 1, ".") && isId(i + 2, "getenv") && is(i + 3, "(") && isStr(i + 4)) {
        out.push({ k: "env", name: at(i + 4)!.v, line: tk.line });
      }
      if (tk.v === "Value" && is(i - 1, "@") && is(i + 1, "(") && isStr(i + 2)) {
        const m = /\$\{([^}:]+)/.exec(at(i + 2)!.v);
        if (m) out.push({ k: "env", name: m[1]!.trim(), line: tk.line });
      }
      if ((tk.v === "SpringApplication" && is(i + 1, ".") && isId(i + 2, "run")) || (tk.v === "SpringBootApplication" && is(i - 1, "@")) || (tk.v === "runApplication" && is(i + 1, "("))) {
        out.push({ k: "listen", line: tk.line });
      }
    }

    // C#
    if (lang === "cs" && tk.t === "id") {
      if (tk.v === "GetEnvironmentVariable" && is(i + 1, "(") && isStr(i + 2)) out.push({ k: "env", name: at(i + 2)!.v, line: tk.line });
      if (/config(uration)?$/i.test(tk.v) && is(i + 1, "[") && isStr(i + 2)) out.push({ k: "env", name: at(i + 2)!.v, line: tk.line });
      if ((tk.v === "GetConnectionString" || tk.v === "GetValue" || tk.v === "GetSection") && is(i + 1, "(") && isStr(i + 2)) {
        out.push({ k: "env", name: tk.v === "GetConnectionString" ? `ConnectionStrings:${at(i + 2)!.v}` : at(i + 2)!.v, line: tk.line });
      }
      if ((tk.v === "WebApplication" && is(i + 1, ".") && isId(i + 2, "CreateBuilder")) || tk.v === "UseKestrel") {
        out.push({ k: "listen", line: tk.line });
      }
    }

    // Ruby
    if (lang === "rb" && tk.t === "id" && tk.v === "ENV") {
      if (is(i + 1, "[") && isStr(i + 2)) out.push({ k: "env", name: at(i + 2)!.v, line: tk.line });
      else if (is(i + 1, ".") && (isId(i + 2, "fetch") || isId(i + 2, "dig")) && (is(i + 3, "(") || isStr(i + 3)) ) {
        const s = is(i + 3, "(") ? i + 4 : i + 3;
        if (isStr(s)) out.push({ k: "env", name: at(s)!.v, line: tk.line });
      }
    }

    // Template literals: `${process.env.X}` is code inside a string token
    if (lang === "js" && tk.t === "tmpl" && tk.v.includes("${")) {
      for (const m of tk.v.matchAll(/\$\{[^}]*?(?:process\.env|import\.meta\.env)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        out.push({ k: "env", name: m[1]!, line: tk.line });
      }
    }

    // HTTP calls, URL constants, connection strings: all keyed off string tokens
    if (tk.t === "str" || tk.t === "tmpl") {
      const url = tokenIsUrl(tk);
      if (url) {
        let direct = false;
        for (let j = i - 1; j >= 0 && j >= i - 9; j--) {
          if (is(j, ";")) break;
          if (isId(j) && isClientId(at(j)!.v)) { direct = true; break; }
        }
        let weak = false;
        if (!direct) {
          for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
            if (isId(j) && WEAK_URL_NAMES.test(at(j)!.v)) { weak = true; break; }
            if (is(j, ";")) break;
          }
        }
        if (direct || weak) out.push({ k: "http", url, line: tk.line, weak: !direct });
      }
      if (tk.t === "str" && /^[a-z][a-z0-9+.-]*:(\/\/|[a-z]+:)/i.test(tk.v) && tk.v.length > 8) {
        out.push({ k: "uri", value: tk.v, line: tk.line });
      }
    }

    // Vendor call-site ids (analytics.identify(...), stripe.paymentIntents.create(...))
    if (tk.t === "id" && CALL_IDS.has(tk.v)) {
      const args: string[] = [];
      let j = i + 1;
      if (is(j, ".")) { // chained: paymentIntents.create(
        while ((is(j, ".") && isId(j + 1)) ) j += 2;
      }
      if (is(j, "(")) {
        let depth = 0;
        for (let k2 = j; k2 < n && k2 < j + 60; k2++) {
          if (is(k2, "(")) depth++;
          else if (is(k2, ")")) { depth--; if (depth === 0) break; }
          else if (isId(k2) || isStr(k2)) args.push(at(k2)!.v);
        }
      }
      out.push({ k: "call", id: tk.v, line: tk.line, args });
    }
  }

  return out;
}

/** Drop imports whose bindings are never referenced elsewhere in the file (dead imports). */
export function dropUnusedImports(signals: Signal[], tokens: Token[]): Signal[] {
  const used = new Map<string, number[]>();
  tokens.forEach((t, idx) => {
    if (t.t !== "id") return;
    const list = used.get(t.v);
    if (list) list.push(idx);
    else used.set(t.v, [idx]);
  });
  return signals.filter((s) => {
    if (s.k !== "import" || s.alwaysUsed || s.bindings.length === 0) return true;
    return s.bindings.some((b) => (used.get(b) ?? []).some((idx) => idx < s.start || idx > s.end));
  });
}

/** Remove regions guarded by a literal `if (false)` / `if False:` so dead code is not evidence. */
export function maskDeadBlocks(tokens: Token[], lang: Lang): Token[] {
  const n = tokens.length;
  const dead = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const t = tokens[i]!;
    if (t.t !== "id" || t.v !== "if") continue;
    if (lang === "js" || lang === "java" || lang === "cs" || lang === "go") {
      const hasParen = tokens[i + 1]?.v === "(";
      const litAt = hasParen ? i + 2 : i + 1;
      const lit = tokens[litAt];
      const closes = hasParen ? tokens[litAt + 1]?.v === ")" : true;
      if (lit && closes && ((lit.t === "id" && lit.v === "false") || (lit.t === "num" && lit.v === "0"))) {
        const open = hasParen ? litAt + 2 : litAt + 1;
        if (tokens[open]?.v === "{") {
          let depth = 0;
          for (let j = open; j < n; j++) {
            if (tokens[j]!.v === "{" && tokens[j]!.t === "p") depth++;
            else if (tokens[j]!.v === "}" && tokens[j]!.t === "p") { depth--; if (depth === 0) { for (let k = i; k <= j; k++) dead[k] = true; break; } }
          }
        }
      }
    } else if (lang === "py") {
      const lit = tokens[i + 1];
      if (lit && lit.t === "id" && (lit.v === "False" || lit.v === "None") && tokens[i + 2]?.v === ":") {
        // The block is every following line indented deeper than the `if`, plus the rest of its own line.
        let j = i + 3;
        while (j < n) {
          const tj = tokens[j]!;
          const firstOnLine = tokens[j - 1]!.line < tj.line;
          if (firstOnLine && tj.col <= t.col) break;
          j++;
        }
        for (let k = i; k < j; k++) dead[k] = true;
      }
    }
  }
  return tokens.filter((_, i) => !dead[i]);
}
