import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Playwright executes outside Next's runtime, so load the local test database
// configuration before specs import their direct database helpers.
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./tests/ui",
  // The standard Playwright pass owns browser/UI journeys only. FastAPI
  // pytest owns server rules, lifecycle transitions, and tenant isolation.
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5001",
    trace: "on-first-retry",
  },
  // Chromium owns the complete browser suite, including the smoke journey.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "./node_modules/.bin/next dev --port 5001",
    url: "http://localhost:5001",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_DIST_DIR: ".next-playwright",
      POSTPILOT_API_ORIGIN: process.env.POSTPILOT_API_ORIGIN ?? "http://127.0.0.1:8000",
      POSTPILOT_API_INTERNAL_URL: process.env.POSTPILOT_API_INTERNAL_URL ?? "http://127.0.0.1:8000",
    },
  },
});
