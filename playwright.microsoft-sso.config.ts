import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const port = 5003;

// This is a browser-only MSAL contract suite. It supplies non-secret test
// configuration and intercepts Entra/token calls; it never talks to a real
// Microsoft tenant or puts a real access token in the test environment.
export default defineConfig({
  testDir: "./tests",
  testMatch: "integration/microsoft-sso-browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `./node_modules/.bin/next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_DIST_DIR: ".next-playwright-microsoft-sso",
      POSTPILOT_DEBUG_DEMO: "false",
      POSTPILOT_API_ORIGIN: process.env.POSTPILOT_API_ORIGIN ?? "http://127.0.0.1:8000",
      POSTPILOT_API_INTERNAL_URL: process.env.POSTPILOT_API_INTERNAL_URL ?? "http://127.0.0.1:8000",
      NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED: "true",
      NEXT_PUBLIC_POSTPILOT_MSAL_CLIENT_ID: "postpilot-browser-test-spa",
      NEXT_PUBLIC_POSTPILOT_MSAL_AUTHORITY: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555",
      NEXT_PUBLIC_POSTPILOT_MSAL_API_SCOPE: "api://postpilot-browser-test-api/access_as_user",
      NEXT_PUBLIC_POSTPILOT_MSAL_REDIRECT_URI: `http://localhost:${port}/sign-in`,
      NEXT_PUBLIC_POSTPILOT_MSAL_TEST_MODE: "true",
    },
  },
});
