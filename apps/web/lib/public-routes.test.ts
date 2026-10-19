import { describe, expect, it } from "vitest";
import { isPublic } from "./public-routes";

describe("isPublic", () => {
  it("allows the landing page, auth pages, shared maps and webhooks", () => {
    for (const p of ["/", "/sign-in", "/sign-up", "/auth/callback", "/map/abc123", "/api/webhooks/github"]) {
      expect(isPublic(p), p).toBe(true);
    }
  });

  it("does not treat '/' as a prefix that makes every path public", () => {
    for (const p of ["/dashboard", "/repos/123", "/api/repos/1/scan", "/api/maps/share", "/api/github/sync", "/dev/scan"]) {
      expect(isPublic(p), p).toBe(false);
    }
  });

  it("does not match look-alike paths", () => {
    expect(isPublic("/mapping")).toBe(false);
    expect(isPublic("/api/webhooksfoo")).toBe(false);
  });
});
