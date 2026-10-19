/**
 * A small lexer used to find evidence in source files.
 *
 * Why not regexes over raw text: regexes cannot tell code from comments, regex literals,
 * or documentation strings, so a pattern table that mentions "sendgrid" would match itself.
 * Here comments and regex literals never become tokens, and string tokens are kept
 * separate from identifiers, so extractors can reason about real code only.
 *
 * It is not a parser. It is accurate enough to split a file into identifiers, punctuation,
 * strings and numbers with correct 1-based line numbers, in the languages we scan.
 */

export type TokenType = "id" | "str" | "tmpl" | "regex" | "num" | "p";

export interface Token {
  t: TokenType;
  /** Identifier text, punctuation, or string content (quotes removed, escapes untouched). */
  v: string;
  line: number;
  /** 0-based column of the token start. */
  col: number;
}

export type Lang = "js" | "py" | "go" | "java" | "cs" | "rb";

interface Profile {
  lineComments: string[];
  blockComment: [string, string] | null;
  quotes: string[];
  templates: boolean;
  tripleQuotes: boolean;
  regexLiterals: boolean;
  stringPrefixes: boolean;
  rubyBlockComments: boolean;
}

const PROFILES: Record<Lang, Profile> = {
  js: { lineComments: ["//"], blockComment: ["/*", "*/"], quotes: ["'", '"'], templates: true, tripleQuotes: false, regexLiterals: true, stringPrefixes: false, rubyBlockComments: false },
  py: { lineComments: ["#"], blockComment: null, quotes: ["'", '"'], templates: false, tripleQuotes: true, regexLiterals: false, stringPrefixes: true, rubyBlockComments: false },
  go: { lineComments: ["//"], blockComment: ["/*", "*/"], quotes: ["'", '"'], templates: true, tripleQuotes: false, regexLiterals: false, stringPrefixes: false, rubyBlockComments: false },
  java: { lineComments: ["//"], blockComment: ["/*", "*/"], quotes: ["'", '"'], templates: false, tripleQuotes: true, regexLiterals: false, stringPrefixes: false, rubyBlockComments: false },
  cs: { lineComments: ["//"], blockComment: ["/*", "*/"], quotes: ["'", '"'], templates: false, tripleQuotes: true, regexLiterals: false, stringPrefixes: false, rubyBlockComments: false },
  rb: { lineComments: ["#"], blockComment: null, quotes: ["'", '"', "`"], templates: false, tripleQuotes: false, regexLiterals: false, stringPrefixes: false, rubyBlockComments: true },
};

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do",
  "instanceof", "yield", "await",
]);

const isIdStart = (c: string) => /[A-Za-z_$\u0080-￿]/.test(c);
const isIdPart = (c: string) => /[A-Za-z0-9_$\u0080-￿]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

export function langForFile(file: string): Lang | null {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".ts": case ".tsx": case ".js": case ".jsx": case ".mjs": case ".cjs": case ".mts": case ".cts":
      return "js";
    case ".py": return "py";
    case ".go": return "go";
    case ".java": case ".kt": return "java";
    case ".cs": return "cs";
    case ".rb": case ".rake": return "rb";
    default: return null;
  }
}

export function tokenize(src: string, lang: Lang): Token[] {
  const p = PROFILES[lang];
  const tokens: Token[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const last = () => tokens[tokens.length - 1];

  const regexAllowed = (): boolean => {
    const prev = last();
    if (!prev) return true;
    if (prev.t === "id") return REGEX_PRECEDING_KEYWORDS.has(prev.v);
    if (prev.t === "p") return !(prev.v === ")" || prev.v === "]" || prev.v === "}");
    return false;
  };

  const countLines = (s: string, base: number) => {
    for (let k = 0; k < s.length; k++) {
      if (s[k] === "\n") {
        line++;
        lineStart = base + k + 1;
      }
    }
  };

  // Scan a quoted string starting at the opening quote; returns [content, endIndex].
  const scanQuoted = (start: number, quote: string, escapes = true): [string, number] => {
    let j = start + 1;
    let out = "";
    while (j < n) {
      const c = src[j]!;
      if (c === "\n") break; // unterminated: stop at end of line to limit damage
      if (escapes && c === "\\" && j + 1 < n) {
        out += c + src[j + 1];
        j += 2;
        continue;
      }
      if (c === quote) return [out, j + 1];
      out += c;
      j++;
    }
    return [out, j];
  };

  const scanTriple = (start: number, quote: string): [string, number] => {
    const close = quote.repeat(3);
    const end = src.indexOf(close, start + 3);
    if (end === -1) return [src.slice(start + 3), n];
    return [src.slice(start + 3, end), end + 3];
  };

  // Template literal: raw text between backticks, skipping ${ ... } expressions.
  const scanTemplate = (start: number): [string, number] => {
    let j = start + 1;
    while (j < n) {
      const c = src[j]!;
      if (c === "\\") { j += 2; continue; }
      if (c === "`") return [src.slice(start + 1, j), j + 1];
      if (c === "$" && src[j + 1] === "{") {
        let depth = 1;
        j += 2;
        while (j < n && depth > 0) {
          const d = src[j]!;
          if (d === "{") depth++;
          else if (d === "}") depth--;
          else if (d === "`") { j = scanTemplate(j)[1]; continue; }
          else if (d === '"' || d === "'") { j = scanQuoted(j, d)[1]; continue; }
          j++;
        }
        continue;
      }
      j++;
    }
    return [src.slice(start + 1), n];
  };

  while (i < n) {
    const c = src[i]!;

    if (c === "\n") { line++; i++; lineStart = i; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    // Ruby =begin/=end block comments (must start a line)
    if (p.rubyBlockComments && c === "=" && src.startsWith("=begin", i) && (i === 0 || src[i - 1] === "\n")) {
      const end = src.indexOf("\n=end", i);
      const stop = end === -1 ? n : end + 5;
      countLines(src.slice(i, stop), i);
      i = stop;
      continue;
    }

    // Comments
    let isComment = false;
    for (const lc of p.lineComments) {
      if (src.startsWith(lc, i)) {
        // C# / Java: "///" doc comments are also comments. Go: "//go:build" too.
        const nl = src.indexOf("\n", i);
        i = nl === -1 ? n : nl;
        isComment = true;
        break;
      }
    }
    if (isComment) continue;
    if (p.blockComment && src.startsWith(p.blockComment[0], i)) {
      const end = src.indexOf(p.blockComment[1], i + 2);
      const stop = end === -1 ? n : end + p.blockComment[1].length;
      countLines(src.slice(i, stop), i);
      i = stop;
      continue;
    }

    // Strings
    if (p.templates && c === "`") {
      const startLine = line;
      const [content, end] = scanTemplate(i);
      tokens.push({ t: lang === "go" ? "str" : "tmpl", v: content, line: startLine, col: i - lineStart });
      countLines(src.slice(i, end), i);
      i = end;
      continue;
    }
    if (p.quotes.includes(c)) {
      const startLine = line;
      if (p.tripleQuotes && src.startsWith(c.repeat(3), i)) {
        const [content, end] = scanTriple(i, c);
        tokens.push({ t: "str", v: content, line: startLine, col: i - lineStart });
        countLines(src.slice(i, end), i);
        i = end;
        continue;
      }
      const [content, end] = scanQuoted(i, c);
      tokens.push({ t: "str", v: content, line: startLine, col: i - lineStart });
      i = end;
      continue;
    }
    // C# verbatim / interpolated strings: @"..." $"..." $@"..."
    if (lang === "cs" && (c === "@" || c === "$") && (src[i + 1] === '"' || ((src[i + 1] === "@" || src[i + 1] === "$") && src[i + 2] === '"'))) {
      const quoteAt = src[i + 1] === '"' ? i + 1 : i + 2;
      const verbatim = src.slice(i, quoteAt).includes("@");
      const startLine = line;
      let j = quoteAt + 1;
      let out = "";
      while (j < n) {
        const d = src[j]!;
        if (verbatim && d === '"' && src[j + 1] === '"') { out += '"'; j += 2; continue; }
        if (d === '"') { j++; break; }
        if (!verbatim && d === "\\") { out += d + (src[j + 1] ?? ""); j += 2; continue; }
        if (d === "\n") { line++; lineStart = j + 1; }
        out += d;
        j++;
      }
      tokens.push({ t: "str", v: out, line: startLine, col: i - lineStart });
      i = j;
      continue;
    }

    // Regex literals (JS)
    if (p.regexLiterals && c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j]!;
        if (d === "\n") break;
        if (d === "\\") { j += 2; continue; }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j++;
      }
      if (src[j] === "/") {
        j++;
        while (j < n && /[a-z]/i.test(src[j]!)) j++;
        tokens.push({ t: "regex", v: src.slice(i, j), line, col: i - lineStart });
        i = j;
        continue;
      }
    }

    // Identifiers (and Python string prefixes)
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src[j]!)) j++;
      const word = src.slice(i, j);
      if (p.stringPrefixes && word.length <= 2 && /^[rRbBfFuU]{1,2}$/.test(word) && (src[j] === '"' || src[j] === "'")) {
        i = j; // let the quote branch read the string; prefix is dropped
        continue;
      }
      tokens.push({ t: "id", v: word, line, col: i - lineStart });
      i = j;
      continue;
    }

    if (isDigit(c)) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX_.eE]/.test(src[j]!)) j++;
      tokens.push({ t: "num", v: src.slice(i, j), line, col: i - lineStart });
      i = j;
      continue;
    }

    // Punctuation: multi-char operators we care about, else single char
    if (c === "?" && src[i + 1] === ".") { tokens.push({ t: "p", v: "?.", line, col: i - lineStart }); i += 2; continue; }
    if (c === ":" && src[i + 1] === ":") { tokens.push({ t: "p", v: "::", line, col: i - lineStart }); i += 2; continue; }
    if (c === "=" && src[i + 1] === ">") { tokens.push({ t: "p", v: "=>", line, col: i - lineStart }); i += 2; continue; }
    tokens.push({ t: "p", v: c, line, col: i - lineStart });
    i++;
  }

  return tokens;
}
