// Snapshot each app route at 1440px wide and save PNGs to /tmp/ui_snaps/
// Used for comparing against the Figma mocks in design/mocks/.

import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "/tmp/ui_snaps";
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { path: "/",                 file: "01_dashboard.png",    h: 1100 },
  { path: "/findings",         file: "02_findings.png",     h: 1100 },
  { path: "/run",              file: "03_run.png",          h: 1300 },
  { path: "/coverage",         file: "04_coverage.png",     h: 1500 },
  { path: "/orchestrator",     file: "05_orchestrator.png", h: 1300 },
  { path: "/runs",             file: "06_run_history.png",  h: 1100 },
  { path: "/dashboard/exec",   file: "07_exec_view.png",    h: 1300 },
];

const BASE = "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

for (const r of ROUTES) {
  console.log(`→ ${r.path}`);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: r.h });
  await page.goto(`${BASE}${r.path}`, { waitUntil: "networkidle", timeout: 15000 });
  // Give TanStack Query a moment to settle
  await page.waitForTimeout(800);
  await page.screenshot({
    path: resolve(OUT, r.file),
    fullPage: false,
    clip: { x: 0, y: 0, width: 1440, height: r.h },
  });
  await page.close();
}

await browser.close();
console.log(`done. PNGs in ${OUT}`);
