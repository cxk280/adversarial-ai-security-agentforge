import { test, expect } from "@playwright/test";

/**
 * User 3 — CISO/Compliance executive view. Verifies the resilience
 * chart, KPI tiles, and the audit/compliance call-out that backs the
 * compliance-report export.
 */
test.describe("Executive View (User 3 — CISO)", () => {
  test("KPIs, resilience trend, and audit call-out all render", async ({
    page,
  }) => {
    await page.goto("/dashboard/exec");

    await expect(
      page.getByRole("heading", { name: "Executive view", level: 1 }),
    ).toBeVisible();

    // KPI labels
    for (const k of ["RESILIENCE", "ACTIVE FINDINGS", "MEAN TIME TO FIX", "COVERAGE"]) {
      await expect(page.getByText(k, { exact: true })).toBeVisible();
    }

    // Trend chart
    await expect(
      page.getByRole("heading", { name: /Resilience over time/ }),
    ).toBeVisible();

    // Audit & Compliance card — the CISO-facing story
    await expect(page.getByText("AUDIT & COMPLIANCE")).toBeVisible();
    await expect(
      page.getByText(/Continuous testing in effect/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Generate compliance report/i }),
    ).toBeVisible();
  });
});
