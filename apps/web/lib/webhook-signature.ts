import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureCheck = "valid" | "invalid" | "no-secret";

/**
 * Verify a GitHub `X-Hub-Signature-256` header.
 *
 * Fails closed: if no secret is configured the result is "no-secret" and the caller must
 * refuse the request. An empty secret must never be usable as an HMAC key.
 */
export function checkGithubSignature(
  secret: string | undefined,
  payload: string,
  header: string | null | undefined
): SignatureCheck {
  if (!secret) return "no-secret";
  if (!header) return "invalid";
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return "invalid";
  return timingSafeEqual(a, b) ? "valid" : "invalid";
}

export function signGithubPayload(secret: string, payload: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}
