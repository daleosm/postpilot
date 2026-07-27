import assert from "node:assert/strict";
import test from "node:test";

// Node's native TypeScript runner requires the explicit extension; Next's
// TypeScript configuration deliberately does not enable that syntax globally.
// @ts-expect-error Node native type-strip test import
import { signOutFromMicrosoft } from "../../src/lib/microsoft-sso.ts";

const envKeys = [
  "NEXT_PUBLIC_POSTPILOT_MSAL_TEST_MODE",
  "NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED",
  "NEXT_PUBLIC_POSTPILOT_MSAL_CLIENT_ID",
  "NEXT_PUBLIC_POSTPILOT_MSAL_AUTHORITY",
  "NEXT_PUBLIC_POSTPILOT_MSAL_API_SCOPE",
  "NEXT_PUBLIC_POSTPILOT_MSAL_REDIRECT_URI",
] as const;

test("Microsoft-only sign-out starts MSAL logout and leaves PostPilot transport untouched", async () => {
  const previousEnvironment = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let logoutRequest: unknown = null;
  let initialized = false;
  const account = { homeAccountId: "test-account" };

  try {
    Object.assign(process.env, {
      NEXT_PUBLIC_POSTPILOT_MSAL_TEST_MODE: "true",
      NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED: "true",
      NEXT_PUBLIC_POSTPILOT_MSAL_CLIENT_ID: "test-spa-client",
      NEXT_PUBLIC_POSTPILOT_MSAL_AUTHORITY: "https://login.microsoftonline.com/test-tenant",
      NEXT_PUBLIC_POSTPILOT_MSAL_API_SCOPE: "api://test-api/access_as_user",
      NEXT_PUBLIC_POSTPILOT_MSAL_REDIRECT_URI: "https://postpilot.test/sign-in",
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __postpilotMicrosoftSsoTestClient__: {
          initialize: async () => { initialized = true; },
          getActiveAccount: () => account,
          getAllAccounts: () => [account],
          logoutRedirect: async (request: unknown) => { logoutRequest = request; },
        },
      },
    });
    globalThis.fetch = async () => { throw new Error("Microsoft-only logout must not call the PostPilot API."); };

    assert.equal(await signOutFromMicrosoft(), true);
    assert.equal(initialized, true);
    assert.deepEqual(logoutRequest, { account, postLogoutRedirectUri: "https://postpilot.test/sign-in" });
  } finally {
    for (const key of envKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    globalThis.fetch = previousFetch;
  }
});

test("Microsoft-only sign-out is unavailable when browser MSAL is not configured", async () => {
  const previousEnabled = process.env.NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED;
  try {
    process.env.NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED = "false";
    assert.equal(await signOutFromMicrosoft(), false);
  } finally {
    if (previousEnabled === undefined) delete process.env.NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED;
    else process.env.NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED = previousEnabled;
  }
});
