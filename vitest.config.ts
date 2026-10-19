import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "apps/web") },
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
