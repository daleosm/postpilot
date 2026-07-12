import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationMembers, people, shows } from "@/lib/db/schema";
import { getDebugUser } from "@/lib/debug-user";
import { getOrganizationMembershipsForUser, type OrganizationMembership } from "@/lib/organization-data";
import { isDebugMode } from "@/lib/runtime";

export const ACTIVE_ORGANIZATION_COOKIE = "posthouse.activeOrganizationId";
export const ACTIVE_SHOW_COOKIE = "postpilot.activeShow";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ActiveOrganizationPerson = { id: string; role: string; name: string };
export type ActiveOrganizationContext = {
  userId: string;
  organization: OrganizationMembership | null;
  memberships: OrganizationMembership[];
  person: ActiveOrganizationPerson | null;
};

export const activeOrganizationCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
};

export type ActiveShow = { id: string; title: string };

/**
 * Resolves the show cookie against the active tenant. A show chosen in a
 * different post house is treated as no selection rather than leaking into a
 * new workspace.
 */
export async function getActiveShow(organizationId?: string): Promise<ActiveShow | null> {
  const cookieStore = await cookies();
  const showId = cookieStore.get(ACTIVE_SHOW_COOKIE)?.value;
  // Older builds stored the display label (for example, "All shows") rather
  // than a UUID. Never send that legacy value to a UUID database column.
  if (!showId || !UUID_PATTERN.test(showId) || !db) return null;

  const resolvedOrganizationId = organizationId ?? (await getActiveOrganizationContext())?.organization?.organizationId;
  if (!resolvedOrganizationId) return null;

  const [show] = await db.select({ id: shows.id, title: shows.title }).from(shows)
    .where(and(eq(shows.id, showId), eq(shows.organizationId, resolvedOrganizationId))).limit(1);
  return show ?? null;
}

export async function getActiveShowName() {
  return (await getActiveShow())?.title ?? null;
}

/** Resolves the authenticated (or debug) actor without accepting client-supplied identity. */
export async function getActiveContextUserId() {
  if (isDebugMode) return (await getDebugUser())?.userId ?? null;
  return (await getServerSession(authOptions))?.user?.id ?? null;
}

/**
 * The active organization is always derived from real memberships. A stale or
 * forged cookie falls back to the first valid membership and never grants access.
 */
export async function getActiveOrganizationContext(): Promise<ActiveOrganizationContext | null> {
  const debugUser = isDebugMode ? await getDebugUser() : null;
  const userId = debugUser?.userId ?? await getActiveContextUserId();
  if (!userId) return null;

  const [memberships, cookieStore] = await Promise.all([getOrganizationMembershipsForUser(userId), cookies()]);
  const requestedId = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const organization = memberships.find((membership) => membership.organizationId === requestedId) ?? memberships[0] ?? null;

  if (!organization) {
    return { userId, organization: null, memberships, person: debugUser ? { id: debugUser.id, name: debugUser.name, role: debugUser.role } : null };
  }

  const [person] = db
    ? await db.select({ id: people.id, role: people.role, name: people.name }).from(people)
      .where(and(eq(people.organizationId, organization.organizationId), eq(people.userId, userId))).limit(1)
    : [];

  return { userId, organization, memberships, person: person ?? null };
}

export async function userCanAccessOrganization(userId: string, organizationId: string) {
  if (!db) return false;
  const membership = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, organizationId)))
    .limit(1);
  return membership.length === 1;
}
