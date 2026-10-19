import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pdfText, signIn, SHOP_REPO } from "./helpers";

test.describe("signed-in workspace", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));
    await signIn(page, "kay");
  });

  test("dashboard lists the repository, and the workspace opens from it", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Repositories", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "acme/shop" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/repos/${SHOP_REPO}`));
    await expect(page.getByTestId("sheet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "acme/shop", level: 1 })).toBeVisible();
  });

  test("scope editor saves a scope that survives a reload", async ({ page }) => {
    await page.goto(`/repos/${SHOP_REPO}?tab=scopes`);
    await expect(page.getByTestId("sheet")).toBeVisible();
    await page.getByLabel("Editing").selectOption("__new__");
    await page.getByLabel("Name", { exact: true }).fill("E2E scope");
    const nodes = page.locator("[data-node-id]:visible");
    await nodes.first().click();
    await nodes.nth(1).click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("scope-count")).toHaveText("2");
    await page.getByRole("button", { name: "Save scope" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Scope saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Editing").locator("option", { hasText: "E2E scope" })).toHaveCount(1);
  });

  test("a reviewer records a decision with a reason, and can undo it", async ({ page }) => {
    await page.goto(`/repos/${SHOP_REPO}`);
    await expect(page.getByTestId("sheet")).toBeVisible();
    // keyboard selection also works when a neighbouring line's hit area overlaps the one we want
    await page.locator("[data-edge-id]:visible").first().focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByLabel("Reason").fill("Confirmed against the runbook");
    await page.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Decision recorded" })).toBeVisible();
    await page.goto(`/repos/${SHOP_REPO}?tab=review`);
    await expect(page.getByRole("region", { name: "Manual decisions" })).toContainText("Confirmed connection");
    await page.getByRole("button", { name: "Undo" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Decision undone" })).toBeVisible();
  });

  test("vendor details are recorded and appear in the CSV", async ({ page }) => {
    await page.goto(`/repos/${SHOP_REPO}?tab=vendors`);
    await page.getByRole("button", { name: /^Edit Stripe/ }).click();
    await page.getByLabel("Purpose").fill("Card payments");
    await page.getByLabel("Data region").fill("US");
    await page.getByLabel("Data processing agreement").selectOption("yes");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Vendor record saved" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Third-party vendors" })).toContainText("Card payments");

    const res = await page.request.get(`/api/repos/${SHOP_REPO}/export?format=csv&framework=soc2`);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("Card payments");
  });

  test("export downloads a PDF with the title block and hash, and records it", async ({ page }) => {
    await page.goto(`/repos/${SHOP_REPO}?tab=export`);
    const hash = (await page.locator(".title-block dd").last().textContent())!.trim();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
    const text = pdfText(await readFile(await download.path()));
    for (const needle of ["acme/shop", "GRAPH HASH", hash]) expect(text, needle).toContain(needle);
    await page.reload();
    await expect(page.getByRole("region", { name: "Past exports" })).toContainText("pdf");
  });

  test("share link: password, expiry, watermark, access log, revoke", async ({ page, browser }) => {
    await page.goto(`/repos/${SHOP_REPO}?tab=share`);
    await page.getByLabel(/Recipient label/).fill("Assessor Co");
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByLabel("Expires").selectOption("7");
    await page.getByRole("button", { name: "Create link" }).click();
    const link = page.getByRole("status").filter({ hasText: "Link created" }).getByRole("link");
    await expect(link).toBeVisible();
    const url = (await link.getAttribute("href"))!;

    // an outsider has no session: they see only the password form
    const outsider = await browser.newContext();
    const anon = await outsider.newPage();
    await anon.goto(url);
    await expect(anon.getByRole("heading", { name: "This architecture is protected" })).toBeVisible();
    await anon.getByLabel("Password").fill("not the password");
    await anon.getByRole("button", { name: "Open" }).click();
    await expect(anon.locator(".error-text")).toContainText(/password/i);
    await anon.getByLabel("Password").fill("correct horse battery");
    await anon.getByRole("button", { name: "Open" }).click();
    await expect(anon.getByRole("heading", { name: "acme/shop", level: 1 })).toBeVisible();
    await expect(anon.getByText("Assessor Co").first()).toBeVisible();
    await expect(anon.locator(".title-block")).toContainText("Graph hash");

    // the owner sees the visit in the access log
    await page.reload();
    await page.getByRole("button", { name: "Access log" }).first().click();
    await expect(page.getByRole("dialog")).toContainText(/ok|password/i);
    await page.keyboard.press("Escape");

    // revoking takes effect immediately
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Link revoked" })).toBeVisible();
    await anon.reload();
    await expect(anon.getByRole("heading", { name: "This link is no longer available" })).toBeVisible();
    await outsider.close();
  });

  test("a plain member can read but not change anything", async ({ page }) => {
    await signIn(page, "lee");
    await page.goto(`/repos/${SHOP_REPO}?tab=scopes`);
    await expect(page.getByRole("button", { name: "Save scope" })).toBeDisabled();
    const res = await page.request.post(`/api/repos/${SHOP_REPO}/scopes`, { data: { name: "nope", nodeIds: [] } });
    expect(res.status()).toBe(403);
  });

  test("another organisation's user cannot see the repository at all", async ({ page }) => {
    await signIn(page, "mia");
    const res = await page.goto(`/repos/${SHOP_REPO}`);
    expect(res?.status()).toBe(404);
    expect((await page.request.get(`/api/repos/${SHOP_REPO}/export?format=json`)).status()).toBe(404);
  });
});
