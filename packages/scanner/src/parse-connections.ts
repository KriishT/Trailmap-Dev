// Detects outbound HTTP calls, database connections, and env-var-based service references

export interface DetectedConnection {
  target: string;       // URL, env var name, or service hint
  kind: "http" | "database" | "queue" | "env-ref";
  confidence: "high" | "medium" | "low";
}

// Known database env var patterns → canonical type
const DB_ENV_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /DATABASE_URL|POSTGRES(?:_URL|_DSN|QL_URL)?/i, name: "postgres" },
  { pattern: /MYSQL(?:_URL|_DSN)?/i, name: "mysql" },
  { pattern: /MONGODB(?:_URI|_URL)?|MONGO_URL/i, name: "mongodb" },
  { pattern: /REDIS(?:_URL|_URI)?/i, name: "redis" },
  { pattern: /SUPABASE_(?:URL|KEY|SERVICE_ROLE)/i, name: "supabase" },
  { pattern: /ELASTICSEARCH_(?:URL|NODE)/i, name: "elasticsearch" },
  { pattern: /RABBITMQ_URL|AMQP_URL/i, name: "rabbitmq" },
  { pattern: /KAFKA_BROKER|KAFKA_URL/i, name: "kafka" },
  { pattern: /NEON_(?:DATABASE|CONNECTION)|NEON_URL/i, name: "postgres" },
  { pattern: /PLANETSCALE_(?:URL|DSN)/i, name: "mysql" },
];

// Known service env var hints
const SERVICE_ENV_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /STRIPE_(?:SECRET|PUBLIC|KEY|API)/i, name: "stripe" },
  { pattern: /SENDGRID_API_KEY|SENDGRID_URL/i, name: "sendgrid" },
  { pattern: /RESEND_API_KEY/i, name: "resend" },
  { pattern: /OPENAI_API_KEY/i, name: "openai" },
  { pattern: /ANTHROPIC_API_KEY/i, name: "anthropic" },
  { pattern: /TWILIO_(?:ACCOUNT|AUTH|SID)/i, name: "twilio" },
  { pattern: /CLOUDINARY_(?:URL|API)/i, name: "cloudinary" },
  { pattern: /S3_(?:BUCKET|ENDPOINT|ACCESS)|AWS_(?:ACCESS_KEY|SECRET_KEY)/i, name: "s3/aws" },
  { pattern: /FIREBASE_(?:URL|API_KEY|PROJECT)/i, name: "firebase" },
  { pattern: /PUSHER_(?:APP|KEY|SECRET)/i, name: "pusher" },
  { pattern: /CLERK_(?:SECRET|PUBLIC)/i, name: "clerk" },
  { pattern: /AUTH0_(?:DOMAIN|CLIENT)/i, name: "auth0" },
  { pattern: /SENTRY_DSN/i, name: "sentry" },
  { pattern: /DATADOG_API_KEY/i, name: "datadog" },
  { pattern: /SEGMENT_WRITE_KEY/i, name: "segment" },
  { pattern: /MIXPANEL_TOKEN/i, name: "mixpanel" },
];

// HTTP call patterns — fetch, axios, got, request, http.get
const HTTP_CALL_PATTERNS = [
  /fetch\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
  /axios\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
  /axios\s*\(\s*\{[^}]*url\s*:\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
  /got\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
  /(?:http|https)\.(?:get|post|request)\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
  /new\s+URL\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
  // env-var interpolated URLs
  /fetch\s*\(\s*`[^`]*\$\{[^}]*(?:URL|HOST|ENDPOINT|BASE)[^}]*\}[^`]*`/g,
  /fetch\s*\(\s*(?:process\.env\.|import\.meta\.env\.)\w+/g,
];

// Internal service reference env var patterns
const INTERNAL_URL_ENV = /(?:_URL|_HOST|_ENDPOINT|_BASE_URL|_SERVICE_URL)\s*=/i;

export function parseConnections(content: string, filePath: string): DetectedConnection[] {
  const results: DetectedConnection[] = [];
  const seen = new Set<string>();

  function add(c: DetectedConnection) {
    const key = `${c.kind}:${c.target}`;
    if (!seen.has(key)) { seen.add(key); results.push(c); }
  }

  // 1. HTTP calls with literal URLs
  for (const pattern of HTTP_CALL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) {
        try {
          const url = new URL(m[1]);
          const host = url.hostname;
          // Skip localhost/127.0.0.1 — those are internal calls we handle via port matching
          if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
            add({ target: `localhost${url.port ? `:${url.port}` : ""}`, kind: "http", confidence: "high" });
          } else if (!host.includes("example") && !host.includes("placeholder")) {
            add({ target: host, kind: "http", confidence: "high" });
          }
        } catch {}
      } else {
        // env-var-based fetch — medium confidence internal call
        add({ target: "env-url", kind: "http", confidence: "medium" });
      }
    }
  }

  // 2. Env file or code referencing known env vars
  const isEnvFile = filePath.endsWith(".env") || filePath.includes(".env.");
  const lines = content.split("\n");
  for (const line of lines) {
    // Database env vars
    for (const { pattern, name } of DB_ENV_PATTERNS) {
      if (pattern.test(line)) {
        add({ target: name, kind: "database", confidence: isEnvFile ? "high" : "medium" });
        break;
      }
    }
    // External service env vars
    for (const { pattern, name } of SERVICE_ENV_PATTERNS) {
      if (pattern.test(line)) {
        add({ target: name, kind: "http", confidence: isEnvFile ? "high" : "medium" });
        break;
      }
    }
    // Internal URL env vars (cross-service references)
    if (INTERNAL_URL_ENV.test(line) && !isEnvFile) {
      const match = line.match(/process\.env\.(\w+)|import\.meta\.env\.(\w+)/);
      if (match) {
        add({ target: match[1] ?? match[2] ?? "env-ref", kind: "http", confidence: "low" });
      }
    }
  }

  return results;
}

// Known DB image/package names → canonical database node name
const DB_PACKAGE_MAP: Record<string, string> = {
  "pg": "postgres", "postgres": "postgres", "@supabase/supabase-js": "supabase",
  "mysql2": "mysql", "mysql": "mysql",
  "mongodb": "mongodb", "mongoose": "mongodb",
  "ioredis": "redis", "redis": "redis",
  "elasticsearch": "elasticsearch", "@elastic/elasticsearch": "elasticsearch",
  "cassandra-driver": "cassandra",
  "sqlite3": "sqlite", "better-sqlite3": "sqlite",
  "prisma": "postgres", "@prisma/client": "postgres",
  "typeorm": "postgres", "sequelize": "postgres",
  "drizzle-orm": "postgres",
  "knex": "postgres",
  "amqplib": "rabbitmq", "kafkajs": "kafka",
};

// Well-known external SaaS package names → display name
const SAAS_PACKAGE_MAP: Record<string, string> = {
  "stripe": "stripe", "@stripe/stripe-js": "stripe",
  "openai": "openai",
  "@anthropic-ai/sdk": "anthropic",
  "sendgrid": "sendgrid", "@sendgrid/mail": "sendgrid",
  "resend": "resend",
  "twilio": "twilio",
  "cloudinary": "cloudinary",
  "firebase": "firebase", "firebase-admin": "firebase",
  "pusher": "pusher", "pusher-js": "pusher",
  "@clerk/nextjs": "clerk", "@clerk/clerk-sdk-node": "clerk",
  "auth0": "auth0", "@auth0/nextjs-auth0": "auth0",
  "@sentry/node": "sentry", "@sentry/nextjs": "sentry",
  "@datadog/datadog-api-client": "datadog",
};

export function classifyPackage(pkg: string): { kind: "database" | "saas" | null; name: string | null } {
  if (DB_PACKAGE_MAP[pkg]) return { kind: "database", name: DB_PACKAGE_MAP[pkg] };
  if (SAAS_PACKAGE_MAP[pkg]) return { kind: "saas", name: SAAS_PACKAGE_MAP[pkg] };
  return { kind: null, name: null };
}
