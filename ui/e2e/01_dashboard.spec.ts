import { test, expect } from "@playwright/test";

/**
 * User 1 — Security Engineer landing on the platform. The dashboard
 * should render its four KPI tiles, the open findings list, and the
 * coverage strip, all on first load.
 */
test.describe("Dashboard (User 1 landing)", () => {
  test("renders sidebar, KPIs, findings, and coverage", async ({ page }) => {
    await page.goto("/");

    // Sidebar brand + nav
    await expect(page.getByText("AgentForge")).toBeVisible();
    await expect(page.getByText("Adversarial AI Security")).toBeVisible();
    await expect(page.getByRole("link", { name: /Dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Findings/i })).toBeVisible();

    // Page title
    await expect(
      page.getByRole("heading", { name: "Security posture overview" }),
    ).toBeVisible();

    // KPIs (all four labels)
    for (const kpi of [
      "OPEN FINDINGS",
      "TARGET PASS RATE",
      "COVERAGE",
      "TODAY'S SPEND",
    ]) {
      await expect(page.getByText(kpi, { exact: true })).toBeVisible();
    }

    // Open Findings section + a critical-severity badge appears
    await expect(page.getByRole("heading", { name: "Open Findings" })).toBeVisible();
    await expect(page.getByTestId("severity-badge-critical").first()).toBeVisible();

    // Coverage strip
    await expect(
      page.getByRole("heading", { name: /Coverage at a glance/i }),
    ).toBeVisible();
    await expect(page.getByText("Prompt Injection")).toBeVisible();
  });

  test("sidebar Findings badge surfaces the open-finding count", async ({ page }) => {
    await page.goto("/");
    // We seeded the mock with at least one open finding, so the badge is present.
    const badge = page
      .getByRole("link", { name: /Findings/i })
      .getByText(/^[1-9]\d*$/);
    await expect(badge).toBeVisible();
  });

  test("sidebar Run campaign CTA is on the Top Bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Run campaign/i })).toBeVisible();
  });
});
