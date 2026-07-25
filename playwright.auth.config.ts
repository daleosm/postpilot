import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const port = 5002;

export default defineConfig({
  testDir: "./tests",
  testMatch: "integration/auth-credentials.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `./node_modules/.bin/next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Keep this non-debug credentials journey separate from the standard
      // UI build so it cannot reuse a client bundle initialised for port 5001.
      NEXT_DIST_DIR: ".next-playwright-auth",
      POSTPILOT_DEBUG_DEMO: "false",
      POSTPILOT_API_ORIGIN: process.env.POSTPILOT_API_ORIGIN ?? "http://127.0.0.1:8000",
      POSTPILOT_API_INTERNAL_URL: process.env.POSTPILOT_API_INTERNAL_URL ?? "http://127.0.0.1:8000",
    },
  },
});
