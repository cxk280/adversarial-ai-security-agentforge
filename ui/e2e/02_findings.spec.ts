import { test, expect } from "@playwright/test";

/**
 * User 1 / User 2 — drill into a finding. Findings list → click row → land
 * on the per-VULN detail page with a runnable reproducer.
 */
test.describe("Findings (User 1 → User 2 hand-off)", () => {
  test("lists the seeded findings with severities and status pills", async ({
    page,
  }) => {
    await page.goto("/findings");
    await expect(
      page.getByRole("heading", { name: "Findings", level: 1 }),
    ).toBeVisible();

    // Each severity tier must render at least one badge in the mock set
    await expect(page.getByTestId("severity-badge-critical").first()).toBeVisible();
    await expect(page.getByTestId("severity-badge-high").first()).toBeVisible();
    await expect(page.getByTestId("severity-badge-medium").first()).toBeVisible();
    await expect(page.getByTestId("severity-badge-low").first()).toBeVisible();

    // Status pills present
    await expect(page.getByTestId("status-pill-open").first()).toBeVisible();
    await expect(page.getByTestId("status-pill-draft").first()).toBeVisible();

    // Draft Queue callout (gated review)
    await expect(page.getByText("DRAFT QUEUE")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Review draft/i }),
    ).toBeVisible();
  });

  test("clicking a finding row navigates to the detail page", async ({ page }) => {
    await page.goto("/findings");
    await page.getByText("VULN-0001").first().click();
    await expect(page).toHaveURL(/\/findings\/VULN-0001/);
    await expect(
      page.getByRole("heading", {
        name: /Cross-patient medication query/i,
      }),
    ).toBeVisible();

    // Reproducer code block is there (curl with --data)
    await expect(page.getByText(/curl -X POST/)).toBeVisible();

    // Action buttons in the sidebar
    await expect(page.getByRole("button", { name: /Mark resolved/i })).toBeVisible();
  });
});
