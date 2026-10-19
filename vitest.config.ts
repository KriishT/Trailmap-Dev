import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web"),
      "@trailmap/graph": path.resolve(__dirname, "packages/graph/src/index.ts"),
      "@trailmap/scanner": path.resolve(__dirname, "packages/scanner/src/index.ts"),
      "@trailmap/pipeline": path.resolve(__dirname, "packages/pipeline/src/index.ts"),
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
  },
});
