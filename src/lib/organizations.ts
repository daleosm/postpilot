import type { OrganizationMembership } from "@/lib/organization-data";
import { getPostPilotApiSession } from "@/lib/postpilot-api-server";

export type ActiveOrganizationPerson = { id: string; role: string; name: string };
export type ActiveOrganizationContext = {
  userId: string;
  organization: OrganizationMembership | null;
  memberships: OrganizationMembership[];
  person: ActiveOrganizationPerson | null;
};

export type ActiveShow = { id: string; title: string };

function apiMemberships(session: NonNullable<Awaited<ReturnType<typeof getPostPilotApiSession>>>): OrganizationMembership[] {
  return session.memberships.map((membership) => ({
    organizationId: membership.organization_id,
    organizationName: membership.organization_name,
    organizationSlug: membership.organization_slug,
    currency: membership.currency,
    role: membership.role as OrganizationMembership["role"],
  }));
}

/**
 * Resolves the FastAPI session's show selection against the active tenant.
 * A show selected in a different post house is treated as no selection.
 */
export async function getActiveShow(organizationId?: string): Promise<ActiveShow | null> {
  const session = await getPostPilotApiSession();
  if (!session?.active_show || (organizationId && session.active_organization_id !== organizationId)) return null;
  return session.active_show;
}

export async function getActiveShowName() {
  return (await getActiveShow())?.title ?? null;
}

/** Resolves the authenticated (or debug) actor without accepting client-supplied identity. */
export async function getActiveContextUserId() {
  return (await getPostPilotApiSession())?.user_id ?? null;
}

/**
 * The active organization is always derived from real memberships. A stale or
 * forged cookie falls back to the first valid membership and never grants access.
 */
export async function getActiveOrganizationContext(): Promise<ActiveOrganizationContext | null> {
  const session = await getPostPilotApiSession();
  if (!session) return null;
  const memberships = apiMemberships(session);
  const organization = memberships.find((membership) => membership.organizationId === session.active_organization_id) ?? null;
  return {
    userId: session.user_id,
    organization,
    memberships,
    person: session.person ? { id: session.person.id, name: session.person.name, role: session.person.role } : null,
  };
}

export async function userCanAccessOrganization(_userId: string, organizationId: string) {
  return (await getActiveOrganizationContext())?.memberships.some((membership) => membership.organizationId === organizationId) ?? false;
}
