// A table of env-var hints, used to describe other people's projects. None of this is
// this service's own configuration.
export const DB_ENV_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /DATABASE_URL|POSTGRES_URL/i, name: "postgres" },
  { pattern: /REDIS_URL/i, name: "redis" },
  { pattern: /SENDGRID_API_KEY/i, name: "sendgrid" },
  { pattern: /STRIPE_SECRET_KEY/i, name: "stripe" },
];

export const VENDOR_NAMES = ["stripe", "sendgrid", "twilio", "openai", "segment"];
export const ENV_NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SEGMENT_WRITE_KEY"];
export const API_DOCS_URL = "https://docs.sendgrid.com/api-reference";
export const SVG_NS = "http://www.w3.org/2000/svg";

export function classify(line: string): string | null {
  for (const p of DB_ENV_PATTERNS) {
    if (p.pattern.test(line)) return p.name;
  }
  if (line.startsWith("postgres://") || line.startsWith("redis://")) return "uri";
  return null;
}
