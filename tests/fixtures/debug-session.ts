import type { BrowserContext } from "@playwright/test";

export const TEST_APP_URL = "http://localhost:5001";

/**
 * Establishes a real debug-mode identity and tenant context before a browser
 * journey. This keeps UI tests explicit about the actor whose workspace is
 * being exercised without putting cookie literals in every spec.
 */
export async function establishDebugSession(context: BrowserContext, userId: string, organizationId: string) {
  // The backend owns the opaque session. Going through its public debug
  // endpoint keeps UI fixtures truthful without manufacturing cookies.
  const session = await context.request.post(`${TEST_APP_URL}/v1/debug/bootstrap`);
  if (!session.ok()) throw new Error(`Could not establish a debug session: ${session.status()}`);
  const user = await context.request.put(`${TEST_APP_URL}/v1/debug/user`, { data: { user_id: userId, pathname: "/" } });
  if (!user.ok()) throw new Error(`Could not assume debug user ${userId}: ${user.status()}`);
  const organization = await context.request.post(`${TEST_APP_URL}/v1/organizations/active`, {
    data: { organization_id: organizationId, pathname: "/" },
  });
  if (!organization.ok()) throw new Error(`Could not activate debug tenant ${organizationId}: ${organization.status()}`);
}
