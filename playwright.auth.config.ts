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
    command: `./node_modules/.bin/next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // This suite runs after the main browser suite but uses a different
      // NEXTAUTH_URL (port 5002). Keep its development build separate so it
      // cannot reuse a client bundle initialised for the port 5001 server.
      NEXT_DIST_DIR: ".next-playwright-auth",
      NEXTAUTH_URL: `http://localhost:${port}`,
      NEXTAUTH_SECRET: "postpilot-auth-test-secret",
      POSTPILOT_DEBUG_DEMO: "false",
    },
  },
});
