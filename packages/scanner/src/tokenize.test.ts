import { describe, expect, it } from "vitest";
import { tokenize, langForFile } from "./tokenize";

const ids = (src: string, lang: Parameters<typeof tokenize>[1]) =>
  tokenize(src, lang).filter((t) => t.t === "id").map((t) => t.v);
const strs = (src: string, lang: Parameters<typeof tokenize>[1]) =>
  tokenize(src, lang).filter((t) => t.t === "str" || t.t === "tmpl").map((t) => t.v);

describe("tokenize: JavaScript / TypeScript", () => {
  it("drops line and block comments", () => {
    const src = `// sendgrid here\n/* stripe\n there */\nconst a = 1;`;
    expect(ids(src, "js")).toEqual(["const", "a"]);
  });

  it("turns regex literals into one opaque token so their contents are never code", () => {
    const toks = tokenize(`const re = /SENDGRID_API_KEY|STRIPE_SECRET/i;`, "js");
    expect(toks.map((t) => t.t)).toEqual(["id", "id", "p", "regex", "p"]);
    expect(toks.some((t) => t.v === "SENDGRID_API_KEY")).toBe(false);
  });

  it("treats / after an identifier or paren as division, not a regex", () => {
    const toks = tokenize(`const x = a / b / c; const y = (a) / 2;`, "js");
    expect(toks.filter((t) => t.t === "regex")).toHaveLength(0);
  });

  it("recognises a regex after return and in call arguments", () => {
    const src = String.raw`function f(s){ return /a\/b[/]c/g.test(s); }` + '\nx.replace(/q/, "z")';
    expect(tokenize(src, "js").filter((t) => t.t === "regex").map((t) => t.v)).toEqual([
      String.raw`/a\/b[/]c/g`,
      "/q/",
    ]);
  });

  it("keeps string contents and decodes template literals as one token", () => {
    expect(strs("fetch('https://api.stripe.com/v1'); f(`x ${a + `y`} z`)", "js")).toEqual([
      "https://api.stripe.com/v1",
      "x ${a + `y`} z",
    ]);
  });

  it("does not treat // inside a string as a comment", () => {
    expect(strs(`const u = "https://example.com/a"; const k = 1;`, "js")).toEqual(["https://example.com/a"]);
    expect(ids(`const u = "https://example.com/a"; const k = 1;`, "js")).toContain("k");
  });

  it("reports 1-based line numbers across comments, strings and templates", () => {
    const src = `a\n/* x\ny */\nb\n\`t\nu\`\nc`;
    const byId = Object.fromEntries(tokenize(src, "js").filter((t) => t.t === "id").map((t) => [t.v, t.line]));
    expect(byId).toEqual({ a: 1, b: 4, c: 7 });
  });

  it("stops an unterminated string at end of line (JSX apostrophes)", () => {
    const src = `<p>Don't stop</p>;\nconst after = 1;`;
    expect(ids(src, "js")).toContain("after");
  });
});

describe("tokenize: Python", () => {
  it("ignores # comments and handles prefixes and triple quotes", () => {
    const src = `# stripe\nx = f"hi {y}"\nd = """doc\nwith stripe\n"""\nz = 1`;
    expect(ids(src, "py")).toEqual(["x", "d", "z"]);
    expect(strs(src, "py")).toEqual(["hi {y}", "doc\nwith stripe\n"]);
  });

  it("keeps line numbers after a triple-quoted string", () => {
    const toks = tokenize(`a = """x\ny\nz"""\nb = 1`, "py");
    expect(toks.find((t) => t.v === "b")?.line).toBe(4);
  });
});

describe("tokenize: other languages", () => {
  it("Go: raw strings and // comments", () => {
    const src = "// kafka\nx := `raw http://a.b`\nos.Getenv(\"KAFKA_BROKERS\")";
    expect(strs(src, "go")).toEqual(["raw http://a.b", "KAFKA_BROKERS"]);
    expect(ids(src, "go")).not.toContain("kafka");
  });

  it("C#: verbatim and interpolated strings", () => {
    const src = 'var a = @"p""q"; var b = $"hi {n}"; // twilio';
    expect(strs(src, "cs")).toEqual(['p"q', "hi {n}"]);
    expect(ids(src, "cs")).not.toContain("twilio");
  });

  it("Java: block comments and text blocks", () => {
    const src = `/* stripe */ String s = """\n  sendgrid\n  """; int x;`;
    expect(ids(src, "java")).toEqual(["String", "s", "int", "x"]);
  });

  it("Ruby: # comments and =begin/=end blocks", () => {
    const src = `=begin\ntwilio\n=end\nENV["A"] # sendgrid\nputs 1`;
    expect(ids(src, "rb")).toEqual(["ENV", "puts"]);
    expect(strs(src, "rb")).toEqual(["A"]);
  });
});

describe("langForFile", () => {
  it("maps extensions", () => {
    expect(langForFile("a/b.tsx")).toBe("js");
    expect(langForFile("a.py")).toBe("py");
    expect(langForFile("a.go")).toBe("go");
    expect(langForFile("A.java")).toBe("java");
    expect(langForFile("A.cs")).toBe("cs");
    expect(langForFile("a.rb")).toBe("rb");
    expect(langForFile("a.txt")).toBeNull();
  });
});
