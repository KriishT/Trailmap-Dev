import { expect, test } from "@playwright/test";
import { githubState, prOpened, runWorker, sendWebhook, signIn, SHOP_REPO } from "./helpers";

test.describe("pull request scope drift", () => {
  test("a PR that adds an analytics vendor fails the check, and acknowledging it turns the check green", async ({ page, request }) => {
    await request.delete("/api/local/github");

    // 1. GitHub tells us a pull request was opened. The route only queues work.
    const bad = await sendWebhook(request, "pull_request", prOpened(), "wrong-secret");
    expect(bad.status()).toBe(401);
    const res = await sendWebhook(request, "pull_request", prOpened());
    expect(res.ok()).toBe(true);

    // 2. The worker picks the job up and posts a check run.
    await runWorker(request);
    const afterCheck = await githubState(request);
    const failing = afterCheck.checkRuns.at(-1)!;
    expect(failing.conclusion).toBe("failure");
    expect(failing.summary ?? "").toMatch(/Mixpanel|vendor/i);
    expect(afterCheck.comments.length).toBe(1);

    // 3. A named person acknowledges it in the review queue.
    await signIn(page, "kay");
    await page.goto(`/repos/${SHOP_REPO}?tab=review`);
    await expect(page.getByText("Pull request #12")).toBeVisible();
    await expect(page.getByText(/new vendor|data class to vendor/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge as accepted risk" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Acknowledged/ })).toBeVisible();

    // 4. The re-check runs and the check goes green, naming who accepted the risk.
    await runWorker(request);
    const final = await githubState(request);
    const latest = final.checkRuns.at(-1)!;
    expect(latest.conclusion).toBe("success");
    expect(latest.summary ?? "").toContain("kay");
    expect(final.comments.length).toBe(1); // the same comment was updated, not duplicated

    await page.reload();
    await expect(page.getByText(/acknowledged by/i)).toBeVisible();
  });
});
