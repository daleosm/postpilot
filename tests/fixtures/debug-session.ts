import type { BrowserContext } from "@playwright/test";

export const TEST_APP_URL = "http://localhost:5001";

/**
 * Establishes a real debug-mode identity and tenant context before a browser
 * journey. This keeps UI tests explicit about the actor whose workspace is
 * being exercised without putting cookie literals in every spec.
 */
export async function useDebugSession(context: BrowserContext, userId: string, organizationId: string) {
  await context.addCookies([
    { name: "postpilot.debugUser", value: userId, url: TEST_APP_URL },
    { name: "posthouse.activeOrganizationId", value: organizationId, url: TEST_APP_URL },
  ]);
}
