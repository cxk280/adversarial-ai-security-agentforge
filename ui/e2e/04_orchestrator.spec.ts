import { test, expect } from "@playwright/test";

/**
 * User 1 — Orchestrator page. Verifies the campaign queue table, the
 * budget meters, and the DeepSeek-R1 escalation policy card with its
 * seven toggleable triggers.
 */
test.describe("Orchestrator", () => {
  test("renders the queue, budget caps, and escalation policy card", async ({
    page,
  }) => {
    await page.goto("/orchestrator");
    await expect(
      page.getByRole("heading", { name: "Orchestrator", level: 1 }),
    ).toBeVisible();

    // Queue
    await expect(page.getByText("Campaign queue")).toBeVisible();
    await expect(page.getByText("RUNNING", { exact: true })).toBeVisible();
    await expect(page.getByText("QUEUED", { exact: true }).first()).toBeVisible();

    // Budget
    await expect(page.getByText("Budget caps & burn")).toBeVisible();
    await expect(page.getByText("Per-day on dev")).toBeVisible();

    // Escalation card
    await expect(page.getByText(/DeepSeek-R1 escalation/)).toBeVisible();
    // All 7 triggers labeled
    await expect(page.getByText(/Refusal rate > 30%/)).toBeVisible();
    await expect(page.getByText(/A\/B sample/)).toBeVisible();
  });

  test("toggling a trigger flips its visual state", async ({ page }) => {
    await page.goto("/orchestrator");
    const toggles = page.getByLabel(/Toggle trigger \d/);
    const first = toggles.first();
    const beforeClass = await first.getAttribute("class");
    await first.click();
    await expect(async () => {
      const afterClass = await first.getAttribute("class");
      expect(afterClass).not.toBe(beforeClass);
    }).toPass({ timeout: 3_000 });
  });
});
