import { expect, test, type Page } from "@playwright/test";
import type { MicrosoftSsoBrowserClient } from "@/lib/microsoft-sso";

const apiScope = "api://postpilot-browser-test-api/access_as_user";

async function installMicrosoftTestClient(page: Page, { redirectAfterLogin = false } = {}) {
  await page.addInitScript(({ redirectAfterLogin: shouldRedirect }) => {
    const account = { homeAccountId: "browser-test-account", localAccountId: "browser-test-user", username: "browser-sso@postpilot.test" };
    const handledKey = "postpilot.msal-test.redirect-handled";
    const client = {
      initialize: async () => undefined,
      handleRedirectPromise: async () => {
        const current = new URL(window.location.href);
        if (current.searchParams.get("msal-test-callback") !== "1" || window.sessionStorage.getItem(handledKey)) return null;
        window.sessionStorage.setItem(handledKey, "true");
        window.history.replaceState({}, "", "/sign-in");
        return { accessToken: "browser-test-entra-api-access-token", account };
      },
      loginRedirect: async (request: unknown) => {
        window.sessionStorage.setItem("postpilot.msal-test.login-request", JSON.stringify(request));
        if (shouldRedirect) window.location.assign("/sign-in?msal-test-callback=1");
      },
      logoutRedirect: async (request: unknown) => {
        window.sessionStorage.setItem("postpilot.msal-test.logout-request", JSON.stringify(request));
        window.location.assign("/sign-in?msal-test-logout=1");
      },
      setActiveAccount: () => undefined,
      getActiveAccount: () => account,
      getAllAccounts: () => [account],
    } as unknown as MicrosoftSsoBrowserClient;
    window.__postpilotMicrosoftSsoTestClient__ = client;
  }, { redirectAfterLogin });
}

test.describe("Microsoft SSO browser journey", () => {
  test.describe.configure({ mode: "serial" });

  test("shows Microsoft alongside password fallback and requests only the delegated API scope", async ({ page }) => {
    await installMicrosoftTestClient(page);
    await page.goto("/sign-in?callbackUrl=%2Fshows");

    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toBeVisible();
    await page.getByRole("button", { name: "Continue with Microsoft" }).click();

    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem("postpilot.msal-test.login-request")))
      .toContain(apiScope);
    const request = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem("postpilot.msal-test.login-request") ?? "{}"));
    expect(request.scopes).toEqual([apiScope]);
    expect(await page.getByLabel("Work email").isVisible()).toBe(true);
  });

  test("completes the component redirect-return exchange using only an Entra bearer token and a safe callback", async ({ page }) => {
    await installMicrosoftTestClient(page, { redirectAfterLogin: true });
    let exchangeAuthorization = "";
    await page.route("**/v1/auth/microsoft/exchange", async (route) => {
      exchangeAuthorization = route.request().headers().authorization ?? "";
      await route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.goto("/sign-in?callbackUrl=https%3A%2F%2Fevil.example%2Fcallback");
    await page.getByRole("button", { name: "Continue with Microsoft" }).click();

    await expect.poll(() => exchangeAuthorization).toBe("Bearer browser-test-entra-api-access-token");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2F$/);
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.evaluate(() => window.sessionStorage.getItem("postpilot.microsoft-sso.callback-path"))).resolves.toBeNull();
  });

  test("shows the real Microsoft error state and keeps password fallback usable when exchange fails", async ({ page }) => {
    await installMicrosoftTestClient(page, { redirectAfterLogin: true });
    await page.route("**/v1/auth/microsoft/exchange", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "invalid" }) }),
    );
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Microsoft" }).click();

    await expect(page.getByText("Microsoft sign-in could not be completed. Use your password to sign in.")).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });
});
