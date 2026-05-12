import { test, expect } from "@playwright/test";

/**
 * User 1 — Ad Hoc Run flow. Form interactions (toggle categories,
 * switch target, change mode) update the live Run Preview card on
 * the right.
 */
test.describe("Ad Hoc Run (User 1 — campaign launch)", () => {
  test("renders the three targets, four selected categories, and the run preview", async ({
    page,
  }) => {
    await page.goto("/run");
    await expect(
      page.getByRole("heading", { name: /Ad hoc adversarial run/i, level: 1 }),
    ).toBeVisible();

    // Target card URLs (uniquely identifies each target's card)
    await expect(page.getByText("ELEVATED")).toBeVisible();
    await expect(
      page.getByText("copilot-agent-qa.up.railway.app"),
    ).toBeVisible();
    await expect(
      page.getByText(/copilot-agent-production-41de\.up\.railway/),
    ).toBeVisible();
    await expect(
      page.getByText(/copilot-agent-dev\.up\.railway\.app/).first(),
    ).toBeVisible();

    // The default-selected categories — exact text (Direct is a substring of Indirect)
    for (const c of [
      "Indirect prompt injection",
      "Cross-patient data exfiltration",
      "Direct prompt injection",
      "Persona hijack — clinical authority",
    ]) {
      await expect(page.getByText(c, { exact: true })).toBeVisible();
    }

    // Run Preview headline
    await expect(page.getByText(/Predicted exploit yield/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Launch campaign/i }),
    ).toBeVisible();
  });

  test("toggling categories updates the run preview attacks estimate", async ({
    page,
  }) => {
    await page.goto("/run");
    const preview = page.locator("text=/≈ \\d+ attacks/");
    const before = await preview.first().textContent();
    // De-select "Direct prompt injection" — its checkbox by accessible name
    await page.getByRole("checkbox", { name: /^Direct prompt injection/ }).click();
    await expect(async () => {
      const after = await preview.first().textContent();
      expect(after).not.toBe(before);
    }).toPass({ timeout: 5_000 });
  });
});
