"use client";

import { BrowserCacheLocation, type Configuration, PublicClientApplication } from "@azure/msal-browser";

export type MicrosoftSsoBrowserConfig = {
  clientId: string;
  authority: string;
  apiScope: string;
  redirectUri: string;
};

let instance: PublicClientApplication | null = null;

/** The narrow MSAL surface PostPilot uses in the browser. */
export type MicrosoftSsoBrowserClient = Pick<
  PublicClientApplication,
  "initialize" | "handleRedirectPromise" | "loginRedirect" | "logoutRedirect" | "setActiveAccount" | "getActiveAccount" | "getAllAccounts"
>;

declare global {
  interface Window {
    /**
     * Test-only MSAL seam. It is read only by a dedicated Playwright build
     * with NEXT_PUBLIC_POSTPILOT_MSAL_TEST_MODE=true; production deployments
     * never set that value and always construct the real MSAL client.
     */
    __postpilotMicrosoftSsoTestClient__?: MicrosoftSsoBrowserClient;
  }
}

/**
 * Public MSAL settings are intentionally absent by default. Enabling the
 * button requires explicit environment configuration and does not replace the
 * opaque FastAPI session used by the rest of PostPilot.
 */
export function microsoftSsoBrowserConfig(): MicrosoftSsoBrowserConfig | null {
  if (process.env.NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED !== "true") return null;
  const clientId = process.env.NEXT_PUBLIC_POSTPILOT_MSAL_CLIENT_ID?.trim();
  const authority = process.env.NEXT_PUBLIC_POSTPILOT_MSAL_AUTHORITY?.trim();
  const apiScope = process.env.NEXT_PUBLIC_POSTPILOT_MSAL_API_SCOPE?.trim();
  const redirectUri = process.env.NEXT_PUBLIC_POSTPILOT_MSAL_REDIRECT_URI?.trim();
  if (!clientId || !authority || !apiScope || !redirectUri) return null;
  return { clientId, authority, apiScope, redirectUri };
}

export function getMicrosoftSsoClient(): MicrosoftSsoBrowserClient | null {
  const settings = microsoftSsoBrowserConfig();
  if (!settings) return null;
  if (process.env.NEXT_PUBLIC_POSTPILOT_MSAL_TEST_MODE === "true" && typeof window !== "undefined") {
    return window.__postpilotMicrosoftSsoTestClient__ ?? null;
  }
  if (!instance) {
    const configuration: Configuration = {
      auth: {
        clientId: settings.clientId,
        authority: settings.authority,
        redirectUri: settings.redirectUri,
        postLogoutRedirectUri: settings.redirectUri,
      },
      cache: {
        // MSAL may cache its own short-lived Entra tokens here. PostPilot API
        // authentication continues to use its HTTP-only cookie.
        cacheLocation: BrowserCacheLocation.SessionStorage,
      },
    };
    instance = new PublicClientApplication(configuration);
  }
  return instance;
}

/**
 * Ends the Microsoft browser session only. It intentionally does not call the
 * PostPilot API, revoke the opaque session cookie, switch tenant, or alter
 * debug impersonation/show selection state.
 */
export async function signOutFromMicrosoft(): Promise<boolean> {
  const settings = microsoftSsoBrowserConfig();
  const client = getMicrosoftSsoClient();
  if (!settings || !client) return false;
  await client.initialize();
  const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
  await client.logoutRedirect({ account, postLogoutRedirectUri: settings.redirectUri });
  return true;
}
