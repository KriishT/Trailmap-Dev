import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pdfText } from "./helpers";

test("a new user goes from sign-up to a first export in under ten minutes (mocked GitHub)", async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const started = Date.now();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));

  // 1. sign up
  await page.goto("/sign-up");
  await page.getByLabel("Email address").fill(`newcomer-${started}@example.test`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Setup" })).toBeVisible();

  // 2. install the (simulated) GitHub App
  await page.getByRole("button", { name: /Install the GitHub App/ }).click();

  // 3. choose a repository
  await page.getByRole("button", { name: "Choose repositories" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("acme/billing-api")).toBeVisible();
  await dialog.getByLabel("acme/billing-api").check();
  await dialog.getByRole("button", { name: /Save 1 selected/ }).click();
  await expect(page.getByRole("link", { name: "acme/billing-api" })).toBeVisible();

  // 4. first scan, with live progress
  await page.getByRole("button", { name: "Run first scan" }).first().click();
  // the row gains an "Open" link once the snapshot exists (the progress text can vanish as the page refreshes)
  await expect(page.getByRole("link", { name: "Open", exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: "acme/billing-api" }).click();
  await expect(page.getByTestId("sheet")).toBeVisible();

  // 5. pick a framework
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel(/PCI DSS/).check();
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Policy saved" })).toBeVisible();

  // 6. define a scope
  await page.getByRole("tab", { name: "Scopes" }).click();
  await expect(page.getByTestId("sheet")).toBeVisible();
  // a brand-new repository has no scopes, so the editor already starts on "New scope"
  await expect(page.getByLabel("Editing")).toHaveValue("__new__");
  // the page may re-render with fresh server data right after the policy was saved, so retry until the value sticks
  const scopeName = page.getByLabel("Name", { exact: true });
  await expect(async () => {
    await scopeName.fill("Payments");
    await expect(scopeName).toHaveValue("Payments", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.locator("[data-node-id]:visible").first().click();
  await page.getByRole("button", { name: "Save scope" }).click();
  // check the saved result rather than the short-lived confirmation message
  await expect(page.getByLabel("Editing").locator("option", { hasText: "Payments" })).toHaveCount(1);

  // 7. export
  await page.getByRole("tab", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  const text = pdfText(await readFile(await download.path()));
  expect(text).toContain("acme/billing-api");
  expect(text).toContain("GRAPH HASH");

  const minutes = (Date.now() - started) / 60000;
  console.log(`ONBOARDING_MINUTES ${minutes.toFixed(2)}`);
  expect(minutes).toBeLessThan(10);

  // the dashboard checklist now shows every step done
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Setup" })).toHaveCount(0);
});
