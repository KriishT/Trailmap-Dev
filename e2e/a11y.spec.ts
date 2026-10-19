import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, SHOP_REPO } from "./helpers";

type Theme = "light" | "dark";

async function useTheme(page: Page, theme: Theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("trailmap-theme", t);
    } catch {
      /* ignore */
    }
  }, theme);
}

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(bad, `${label}\n${report}`).toEqual([]);
}

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  const sheet = page.getByTestId("sheet");
  if (await sheet.count()) await expect(sheet.first()).toBeVisible();
};

for (const theme of ["light", "dark"] as const) {
  test.describe(`accessibility, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await useTheme(page, theme);
    });

    test("landing page", async ({ page }) => {
      await page.goto("/");
      await settle(page);
      await expectNoSeriousViolations(page, "landing");
    });

    test("sign-in", async ({ page }) => {
      await page.goto("/sign-in");
      await settle(page);
      await expectNoSeriousViolations(page, "sign-in");
    });

    test("sample workspace: sheet, inspector open", async ({ page }) => {
      await page.goto("/demo");
      await settle(page);
      await page.locator("[data-node-id]:visible").first().click();
      await expectNoSeriousViolations(page, "demo system sheet");
    });

    for (const tab of ["data-flow", "vendors", "revisions", "review", "scopes", "export", "share", "settings"]) {
      test(`sample workspace: ${tab}`, async ({ page }) => {
        await page.goto(`/demo?tab=${tab}`);
        await settle(page);
        await expectNoSeriousViolations(page, `demo ${tab}`);
      });
    }

    test("dashboard and repository workspace (signed in)", async ({ page }) => {
      await signIn(page, "kay");
      await page.goto("/dashboard");
      await settle(page);
      await expectNoSeriousViolations(page, "dashboard");
      for (const tab of ["system", "vendors", "review", "export"]) {
        await page.goto(`/repos/${SHOP_REPO}?tab=${tab}`);
        await settle(page);
        await expectNoSeriousViolations(page, `repo ${tab}`);
      }
    });

    test("shared view and its password gate", async ({ page, browser, baseURL }) => {
      await signIn(page, "kay");
      const snapshotId = (await (await page.request.get(`/api/repos/${SHOP_REPO}/export?format=json`)).json()).snapshotId as string;
      const open = await (await page.request.post("/api/maps/share", { data: { snapshotId, label: `a11y ${theme}` } })).json();
      const locked = await (await page.request.post("/api/maps/share", { data: { snapshotId, password: "a11y-password-1", label: `locked ${theme}` } })).json();

      const outsider = await browser.newContext({ baseURL });
      const anon = await outsider.newPage();
      await useTheme(anon, theme);
      await anon.goto(`/map/${locked.slug}`);
      await expectNoSeriousViolations(anon, "share password gate");
      await anon.goto(`/map/${open.slug}`);
      await expect(anon.getByRole("heading", { name: "acme/shop", level: 1 })).toBeVisible();
      await expectNoSeriousViolations(anon, "shared sheets");
      await outsider.close();
    });
  });
}
