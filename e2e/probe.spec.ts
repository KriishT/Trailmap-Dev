import { test } from "@playwright/test";
test("probe", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "docs/screenshots/_probe-landing.png", fullPage: false });
  await page.goto("/demo");
  await page.waitForSelector('[data-testid="sheet"]');
  await page.screenshot({ path: "docs/screenshots/_probe-demo.png" });
});
