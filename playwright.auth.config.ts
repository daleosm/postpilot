import { defineConfig, devices } from "@playwright/test";

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
    command: `pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Reuse the already-configured Playwright build directory so Next does
      // not amend tsconfig.json whenever this isolated suite starts.
      NEXT_DIST_DIR: ".next-playwright",
      NEXTAUTH_URL: `http://localhost:${port}`,
      NEXTAUTH_SECRET: "postpilot-auth-test-secret",
      POSTPILOT_DEBUG_DEMO: "false",
    },
  },
});
