import { describe, expect, it } from "vitest";
import { tokenize, type Lang } from "./tokenize";
import { dropUnusedImports, extractSignals, maskDeadBlocks, type Signal } from "./extract";

function run(src: string, lang: Lang, opts: { dead?: boolean } = {}): Signal[] {
  let tokens = tokenize(src, lang);
  if (opts.dead !== false) tokens = maskDeadBlocks(tokens, lang);
  return dropUnusedImports(extractSignals(tokens, lang), tokens);
}
const of = <K extends Signal["k"]>(sigs: Signal[], k: K) => sigs.filter((s): s is Extract<Signal, { k: K }> => s.k === k);
const specs = (sigs: Signal[]) => of(sigs, "import").map((s) => s.spec);
const envs = (sigs: Signal[]) => of(sigs, "env").map((s) => s.name);

describe("JS/TS imports", () => {
  it("finds default, named, namespace, side-effect, dynamic and require imports", () => {
    const src = [
      `import Stripe from "stripe";`,
      `import { Pool as P } from "pg";`,
      `import * as sg from "@sendgrid/mail";`,
      `import "dotenv/config";`,
      `const m = await import("mongodb");`,
      `const r = require("redis");`,
      `Stripe; P; sg; m; r;`,
    ].join("\n");
    expect(specs(run(src, "js"))).toEqual(["stripe", "pg", "@sendgrid/mail", "dotenv/config", "mongodb", "redis"]);
  });

  it("ignores type-only imports and imports inside comments, strings and regexes", () => {
    const src = [
      `import type { Stripe } from "stripe";`,
      `// import x from "twilio";`,
      `/* const y = require("redis"); */`,
      `const s = 'import z from "kafkajs"';`,
      `const re = /require\\("pg"\\)/;`,
    ].join("\n");
    expect(specs(run(src, "js"))).toEqual([]);
  });

  it("drops an import whose binding is never used (dead import) but keeps side-effect imports", () => {
    const src = `import Stripe from "stripe";\nimport "dotenv/config";\nconsole.log(1);`;
    expect(specs(run(src, "js"))).toEqual(["dotenv/config"]);
  });

  it("keeps an import that is used", () => {
    const src = `import Stripe from "stripe";\nconst s = new Stripe(key);`;
    expect(specs(run(src, "js"))).toEqual(["stripe"]);
  });

  it("handles re-exports", () => {
    expect(specs(run(`export { a } from "./a";\nexport * from "pg";`, "js"))).toEqual(["./a", "pg"]);
  });
});

describe("JS/TS environment reads", () => {
  it("reads process.env.X, process.env['X'], import.meta.env.X and destructuring", () => {
    const src = [
      `const a = process.env.STRIPE_SECRET_KEY;`,
      `const b = process.env["DATABASE_URL"];`,
      `const c = import.meta.env.VITE_API;`,
      `const { REDIS_URL, PORT: p = "3000" } = process.env;`,
    ].join("\n");
    expect(envs(run(src, "js"))).toEqual(["STRIPE_SECRET_KEY", "DATABASE_URL", "VITE_API", "REDIS_URL", "PORT"]);
  });

  it("does not count variable names in comments, regexes or plain strings", () => {
    const src = [
      `// process.env.SENDGRID_API_KEY`,
      `const r = /SENDGRID_API_KEY|STRIPE_SECRET/i;`,
      `const names = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];`,
    ].join("\n");
    expect(envs(run(src, "js"))).toEqual([]);
  });
});

describe("JS/TS http calls", () => {
  it("finds literal URLs inside client calls with their line", () => {
    const src = `\nconst r = await fetch("https://api.stripe.com/v1/charges");\naxios.post('https://api.segment.io/v1/track', body);`;
    const http = of(run(src, "js"), "http");
    expect(http.map((h) => [h.url, h.line, h.weak])).toEqual([
      ["https://api.stripe.com/v1/charges", 2, false],
      ["https://api.segment.io/v1/track", 3, false],
    ]);
  });

  it("uses only the literal prefix of a template and rejects placeholders in the host", () => {
    const src = "fetch(`http://payments:8080/charge/${id}`);\nfetch(`https://${HOST}/x`);";
    const http = of(run(src, "js"), "http");
    expect(http.map((h) => h.url)).toEqual(["http://payments:8080/charge/"]);
  });

  it("marks URL constants as weak and ignores unrelated URLs", () => {
    const src = `const API_URL = "https://api.openai.com/v1";\nconst xmlns = "http://www.w3.org/2000/svg";`;
    const http = of(run(src, "js"), "http");
    expect(http).toHaveLength(1);
    expect(http[0]).toMatchObject({ url: "https://api.openai.com/v1", weak: true });
  });
});

describe("connection strings and listen", () => {
  it("finds connection-string literals", () => {
    const uris = of(run(`const u = "postgres://app:pw@db:5432/app";`, "js"), "uri");
    expect(uris[0]?.value).toBe("postgres://app:pw@db:5432/app");
  });

  it("finds listen calls with a port", () => {
    const l = of(run(`app.listen(4000, () => {});`, "js"), "listen");
    expect(l[0]).toMatchObject({ port: 4000 });
  });
});

describe("vendor call sites", () => {
  it("captures identifiers inside the call arguments", () => {
    const calls = of(run(`analytics.identify(user.id, { email: user.email, plan: "pro" });`, "js"), "call");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("email");
  });
});

describe("dead code", () => {
  it("masks if (false) blocks in C-like languages", () => {
    const src = `if (false) {\n  const s = require("stripe");\n}\nconst p = require("pg"); p;`;
    expect(specs(run(src, "js"))).toEqual(["pg"]);
  });

  it("masks `if False:` blocks in Python by indentation", () => {
    const src = ["import os", "if False:", "    import stripe", "    stripe.x()", "import redis", "redis.Redis()"].join("\n");
    expect(specs(run(src, "py"))).toEqual(["redis"]);
  });
});

describe("Python", () => {
  it("handles import, from-import with aliases, and env reads", () => {
    const src = [
      `import psycopg2`,
      `import boto3 as b`,
      `from google.cloud import storage`,
      `from . import local`,
      `url = os.environ["DATABASE_URL"]`,
      `key = os.getenv("STRIPE_API_KEY", "x")`,
      `psycopg2.connect(url); b.client("s3"); storage.Client()`,
    ].join("\n");
    const sigs = run(src, "py");
    expect(specs(sigs)).toEqual(["psycopg2", "boto3", "google.cloud"]);
    expect(of(sigs, "import")[2]?.also).toEqual(["google.cloud.storage"]);
    expect(envs(sigs)).toEqual(["DATABASE_URL", "STRIPE_API_KEY"]);
    expect(of(sigs, "boto").map((b) => b.service)).toEqual(["s3"]);
  });
});

describe("Go", () => {
  it("reads grouped imports and os.Getenv", () => {
    const src = [
      `package main`,
      `import (`,
      `  "net/http"`,
      `  kafka "github.com/segmentio/kafka-go"`,
      `  _ "github.com/lib/pq"`,
      `)`,
      `func main() { b := os.Getenv("KAFKA_BROKERS"); http.ListenAndServe(":8080", nil) }`,
    ].join("\n");
    const sigs = run(src, "go");
    expect(specs(sigs)).toEqual(["net/http", "github.com/segmentio/kafka-go", "github.com/lib/pq"]);
    expect(envs(sigs)).toEqual(["KAFKA_BROKERS"]);
    expect(of(sigs, "listen")[0]).toMatchObject({ port: 8080 });
  });
});

describe("Java, C#, Ruby", () => {
  it("Java imports and System.getenv", () => {
    const src = `import org.postgresql.Driver;\nimport static com.stripe.Stripe.apiKey;\nclass A { String k = System.getenv("STRIPE_API_KEY"); }`;
    const sigs = run(src, "java");
    expect(specs(sigs)).toEqual(["org.postgresql.Driver", "com.stripe.Stripe.apiKey"]);
    expect(envs(sigs)).toEqual(["STRIPE_API_KEY"]);
  });

  it("C# using directives, not using statements", () => {
    const src = `using Npgsql;\nusing static Stripe.StripeConfiguration;\nclass A { void M() { using (var x = new Y()) {} using var z = new W(); var u = Configuration["Services:Payments:Url"]; } }`;
    const sigs = run(src, "cs");
    expect(specs(sigs)).toEqual(["Npgsql", "Stripe.StripeConfiguration"]);
    expect(envs(sigs)).toEqual(["Services:Payments:Url"]);
  });

  it("Ruby require and ENV", () => {
    const src = `require 'twilio-ruby'\nrequire_relative 'x'\nsid = ENV['TWILIO_ACCOUNT_SID']\nt = ENV.fetch("TWILIO_AUTH_TOKEN")`;
    const sigs = run(src, "rb");
    expect(specs(sigs)).toEqual(["twilio-ruby"]);
    expect(envs(sigs)).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);
  });
});
