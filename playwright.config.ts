import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the production build in local mode: an embedded Postgres with the real
 * migrations and a mocked GitHub, so every flow works with no accounts and no network.
 * Build first (`npm run build`), then `npm run e2e`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  // The local database is shared by every test, so the stateful flows run one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop", testIgnore: /responsive/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", testMatch: /responsive|a11y/, use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: `npm run start --workspace=@trailmap/web -- --port ${PORT}`,
        url: `http://localhost:${PORT}/sign-in`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          TRAILMAP_LOCAL: "1",
          TRAILMAP_LOCAL_SANDBOX: "i-understand-this-uses-no-real-data",
          GITHUB_WEBHOOK_SECRET: "e2e-secret",
          SHARE_COOKIE_SECRET: "e2e-share-secret-0123456789",
        },
      },
});
