import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pdfText } from "./helpers";

test.describe("sample workspace (no sign-in)", () => {
  test.beforeEach(({ page }) => {
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));
  });

  test("landing leads to the sample, which shows sheets with evidence", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("architecture diagram");
    await page.getByRole("link", { name: "Open the sample workspace" }).first().click();
    await expect(page).toHaveURL(/\/demo/);

    const sheet = page.getByTestId("sheet");
    await expect(sheet).toBeVisible();
    expect(Number(await sheet.getAttribute("data-node-count"))).toBeGreaterThan(5);

    // select a box: the inspector explains it and shows the code behind it
    await page.locator("[data-node-id]:visible", { hasText: "payments" }).first().click();
    const inspector = page.getByTestId("inspector");
    await expect(inspector.getByRole("heading", { name: "payments", level: 3 })).toBeVisible();
    await expect(inspector.getByRole("list", { name: "Evidence" })).toBeVisible();
  });

  test("keyboard: arrow keys move between boxes and Enter selects", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByTestId("sheet")).toBeVisible();
    const first = page.locator("[data-node-id]:visible").first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    const focusedId = await page.evaluate(() => document.activeElement?.getAttribute("data-node-id"));
    expect(focusedId).toBeTruthy();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector").getByRole("heading", { level: 3 }).first()).toBeVisible();
  });

  test("vendors, revisions and review queue", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("tab", { name: "Vendors" }).click();
    await expect(page.getByRole("region", { name: "Third-party vendors" })).toContainText("Stripe");
    await page.getByRole("tab", { name: "Revisions" }).click();
    for (const rev of ["Rev A", "Rev F"]) await expect(page.getByRole("list", { name: /Revisions/ })).toContainText(rev);
    await page.getByRole("tab", { name: /Review/ }).click();
    await expect(page.getByText("Pull request #12")).toBeVisible();
  });

  test("time travel: viewing Rev A shows the earlier architecture", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByTestId("sheet")).toBeVisible();
    const latest = Number(await page.getByTestId("sheet").getAttribute("data-node-count"));
    await page.getByLabel("Revision").selectOption("0");
    await expect(page).toHaveURL(/rev=0/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Rev A/).first()).toBeVisible();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // the drawing is fetched again for the older revision, so wait for it rather than reading the old one
    await expect.poll(async () => Number(await page.getByTestId("sheet").getAttribute("data-node-count"))).toBeLessThan(latest);
  });

  test("scope editor: click, shift-click and lasso change the draft", async ({ page }) => {
    await page.goto("/demo?tab=scopes");
    await expect(page.getByTestId("sheet")).toBeVisible();
    const count = page.getByTestId("scope-count");
    const before = Number(await count.textContent());
    const target = page.locator("[data-node-id]:visible", { hasText: "orders" }).first();
    await target.click();
    await expect(count).toHaveText(String(before + 1));
    await target.click();
    await expect(count).toHaveText(String(before));
    await target.click({ modifiers: ["Shift"] });
    await expect(count).toHaveText(String(before + 1));

    // a lasso across the whole sheet adds every box it touches
    const frame = page.locator(".sheet-frame");
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 8 });
    await page.mouse.up();
    const total = Number(await page.getByTestId("sheet").getAttribute("data-node-count"));
    expect(Number(await count.textContent())).toBeGreaterThanOrEqual(Math.min(total, before + 2));
  });

  test("export PDF contains the title block text and the graph hash", async ({ page }) => {
    await page.goto("/demo?tab=export");
    const titleBlock = page.locator(".title-block");
    await expect(titleBlock).toContainText("acme/shop");
    const hash = (await titleBlock.locator("dd").last().textContent())!.trim();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(bytes);
    for (const needle of ["acme/shop", "GRAPH HASH", hash, "Vendor and subprocessor inventory"]) expect(text, needle).toContain(needle);
    await expect(page.getByRole("status").filter({ hasText: "downloaded" })).toContainText(hash.slice(0, 8));
  });

  test("command palette opens with Ctrl+K and jumps to a sheet", async ({ page }) => {
    await page.goto("/demo");
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: /Search commands/ });
    await expect(box).toBeVisible();
    await box.fill("go to vendors");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Vendors" })).toHaveAttribute("aria-selected", "true");
  });

  test("theme toggle switches to blueprint and the choice sticks", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("banner").getByRole("button", { name: /Switch to dark theme/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
