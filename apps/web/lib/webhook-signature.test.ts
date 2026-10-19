import { describe, expect, it } from "vitest";
import { checkGithubSignature, signGithubPayload } from "./webhook-signature";

const body = JSON.stringify({ zen: "Keep it logically awesome." });

describe("checkGithubSignature", () => {
  it("accepts a correct signature", () => {
    expect(checkGithubSignature("s3cret", body, signGithubPayload("s3cret", body))).toBe("valid");
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(checkGithubSignature("s3cret", body, signGithubPayload("other", body))).toBe("invalid");
  });

  it("rejects a tampered body", () => {
    const sig = signGithubPayload("s3cret", body);
    expect(checkGithubSignature("s3cret", body + " ", sig)).toBe("invalid");
  });

  it("rejects a missing or malformed header without throwing", () => {
    expect(checkGithubSignature("s3cret", body, null)).toBe("invalid");
    expect(checkGithubSignature("s3cret", body, "sha256=abc")).toBe("invalid");
    expect(checkGithubSignature("s3cret", body, "")).toBe("invalid");
  });

  it("fails closed when the secret is unset: a signature made with an empty key is not accepted", () => {
    const forged = signGithubPayload("", body);
    expect(checkGithubSignature(undefined, body, forged)).toBe("no-secret");
    expect(checkGithubSignature("", body, forged)).toBe("no-secret");
  });
});
