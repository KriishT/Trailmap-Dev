import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { signIn, SHOP_REPO } from "./helpers";

/**
 * Screenshots of the main screens at 1440 and 768 pixels wide in both themes, saved to docs/screenshots.
 * They double as a layout check: no page may scroll sideways, and the sheet stays usable at tablet width.
 */
const DIR = "docs/screenshots";
mkdirSync(DIR, { recursive: true });

const SCREENS: Array<{ name: string; path: string; signedIn?: boolean; ready?: (p: Page) => Promise<void> }> = [
  { name: "landing", path: "/" },
  { name: "sample-system-sheet", path: "/demo", ready: async (p) => { await expect(p.getByTestId("sheet")).toBeVisible(); } },
  { name: "sample-data-flow-sheet", path: "/demo?tab=data-flow", ready: async (p) => { await expect(p.getByTestId("sheet")).toBeVisible(); } },
  { name: "sample-vendors", path: "/demo?tab=vendors" },
  { name: "sample-review-queue", path: "/demo?tab=review" },
  { name: "sample-scope-editor", path: "/demo?tab=scopes", ready: async (p) => { await expect(p.getByTestId("sheet")).toBeVisible(); } },
  { name: "sample-export-preview", path: "/demo?tab=export" },
  { name: "dashboard", path: "/dashboard", signedIn: true },
  { name: "workspace-revisions", path: `/repos/${SHOP_REPO}?tab=revisions`, signedIn: true },
  { name: "sign-in", path: "/sign-in" },
];

for (const theme of ["light", "dark"] as const) {
  for (const screen of SCREENS) {
    test(`${screen.name} (${theme})`, async ({ page }, info) => {
      const width = page.viewportSize()!.width;
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("trailmap-theme", t);
        } catch {
          /* ignore */
        }
      }, theme);
      if (screen.signedIn) await signIn(page, "kay");
      await page.goto(screen.path);
      await page.waitForLoadState("networkidle");
      await screen.ready?.(page);
      await page.evaluate(() => document.fonts.ready);

      // nothing may force the page to scroll sideways
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${screen.name} overflows horizontally at ${width}px`).toBeLessThanOrEqual(1);

      await page.screenshot({ path: `${DIR}/${screen.name}-${theme}-${width}.png`, fullPage: screen.name === "landing" });
      info.annotations.push({ type: "screenshot", description: `${screen.name}-${theme}-${width}.png` });
    });
  }
}
