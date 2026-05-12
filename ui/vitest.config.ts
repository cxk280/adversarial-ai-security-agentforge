import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: false,
    // Vitest's default include matches *.test.ts*; default exclude includes
    // node_modules/dist/etc. but NOT e2e/, so Vitest would try to load
    // Playwright specs and choke on `test.describe()` since the two
    // frameworks export different `test` symbols.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "playwright-report/**"],
  },
});
