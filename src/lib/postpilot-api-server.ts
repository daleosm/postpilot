import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

export type ApiSession = {
  authenticated_user_id: string;
  user_id: string;
  user_name: string | null;
  active_organization_id: string | null;
  memberships: Array<{
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    currency: string;
    role: string;
  }>;
  person: { id: string; name: string; role: string } | null;
  permissions: string[];
  active_show: { id: string; title: string } | null;
  debug_can_switch: boolean;
};

/**
 * Preserve the HTTP status for server components.  Treating every failed API
 * request as a missing record made genuine FastAPI failures render as a Next
 * 404, which is both misleading to operators and hides actionable errors.
 */
export class PostPilotApiServerError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PostPilotApiServerError";
  }
}

/**
 * Server components forward the browser's opaque API-session cookie, never a
 * database connection or a client-selected organisation ID. In Kubernetes the
 * private service URL avoids routing server-to-server calls through the ALB.
 */
async function apiOriginAndCookie() {
  const requestHeaders = await headers();
  return {
    origin: process.env.POSTPILOT_API_INTERNAL_URL
    ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`,
    cookie: requestHeaders.get("cookie") ?? "",
  };
}

export async function postpilotApiServerFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { origin, cookie } = await apiOriginAndCookie();
  const response = await fetch(`${origin}/v1${path}`, {
    ...init,
    headers: { cookie, ...init.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new PostPilotApiServerError(
      response.status,
      typeof payload?.detail === "string"
        ? payload.detail
        : `PostPilot API request failed (${response.status}).`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const getPostPilotApiSession = cache(async (): Promise<ApiSession | null> => {
  const { origin, cookie } = await apiOriginAndCookie();
  const response = await fetch(`${origin}/v1/auth/session`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`PostPilot API session lookup failed (${response.status}).`);
  return response.json() as Promise<ApiSession>;
});
