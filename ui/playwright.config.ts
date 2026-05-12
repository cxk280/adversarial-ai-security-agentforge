import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config. One spec per primary user workflow from USERS.md.
 *
 * Two run modes:
 *   - `PLAYWRIGHT_BASE_URL=http://localhost:3000`     local dev (default)
 *   - `PLAYWRIGHT_BASE_URL=https://adversary-ui-dev.up.railway.app`  deployed
 *
 * CircleCI nightly uses the deployed mode (see .circleci/config.yml job
 * `playwright-e2e`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,           // sequential — the SQLite write path
                                  // serializes, and parallel runs collide
                                  // on the Recent Runs assertions.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
