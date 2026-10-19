import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web"),
      "@trailmap/graph": path.resolve(__dirname, "packages/graph/src/index.ts"),
      "@trailmap/scanner": path.resolve(__dirname, "packages/scanner/src/index.ts"),
      "@trailmap/pipeline/context": path.resolve(__dirname, "packages/pipeline/src/context-entry.ts"),
      "@trailmap/pipeline": path.resolve(__dirname, "packages/pipeline/src/index.ts"),
      "@trailmap/frameworks": path.resolve(__dirname, "packages/frameworks/src/index.ts"),
      "@trailmap/cli": path.resolve(__dirname, "packages/cli/src/index.ts"),
      "@trailmap/sheets": path.resolve(__dirname, "packages/sheets/src/index.ts"),
      "@trailmap/integrations": path.resolve(__dirname, "packages/integrations/src/index.ts"),
      "@trailmap/localdb": path.resolve(__dirname, "packages/localdb/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/*/lib/**/*.test.ts",
      "apps/*/app/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "supabase/tests/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["packages/scanner/src/**", "packages/pipeline/src/**", "packages/graph/src/**", "apps/web/lib/**"],
      // Excluded: thin adapters to things that only exist at runtime. The Octokit wrapper needs a real GitHub App;
      // the local-mode database and mocked GitHub are exercised end to end by the Playwright suite (e2e/).
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/index.ts", "**/types.ts", "**/scanner-port.ts", "apps/web/lib/github-api.ts", "apps/web/lib/local-db.ts", "apps/web/lib/local-github.ts"],
      thresholds: {
        "packages/scanner/src/**": { lines: 80, statements: 80, functions: 80, branches: 70 },
        "packages/pipeline/src/**": { lines: 80, statements: 80, functions: 80, branches: 70 },
        "apps/web/lib/**": { lines: 80, statements: 80, functions: 80, branches: 70 },
      },
    },
  },
});
