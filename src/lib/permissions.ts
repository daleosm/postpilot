import { and, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { episodeTeamAssignments, episodes, organizationRolePolicies } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { clientRolePolicy, normalizePermission, normalizePermissions, policyGrants, type Permission, type TenantRolePolicy } from "@/lib/permissions-core";

export { clientRolePolicy, normalizePermission, normalizePermissions, permissions, policyGrants } from "@/lib/permissions-core";
export type { Permission, TenantRolePolicy } from "@/lib/permissions-core";

/**
 * Tenant policy capabilities. These deliberately describe an action, rather
 * than a post-production job title. A post house can therefore give the same
 * authority to any of its own roles without changing workflow code.
 */
export const isFixedRole = (role: string) => role === clientRolePolicy.role;

/**
 * A short-lived compatibility bridge for policies saved before stages became
 * the sole workflow model. The migration rewrites persisted policies, while
 * this prevents an older tenant backup from accidentally losing access during
 * a staged deployment.
 */
/** Roles are tenant data, apart from the fixed external Client role. */
export async function getTenantRolePolicies(organizationId: string): Promise<TenantRolePolicy[]> {
  if (!db) return [clientRolePolicy];
  const policies = await db.select({ role: organizationRolePolicies.role, label: organizationRolePolicies.label, permissions: organizationRolePolicies.permissions })
    .from(organizationRolePolicies).where(eq(organizationRolePolicies.organizationId, organizationId));
  const configurable = policies.filter((policy) => !isFixedRole(policy.role)).map((policy) => ({ role: policy.role, label: policy.label, permissions: normalizePermissions(policy.permissions) }));
  return [clientRolePolicy, ...configurable];
}

export async function getCurrentPerson() {
  const context = await getActiveOrganizationContext();
  return context?.person ?? null;
}

export async function can(permission: Permission | string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return false;
  const normalized = normalizePermission(permission);
  if (!normalized) return false;
  if (context.organization.role === "client") return policyGrants(normalized, context.organization.role, []);
  // Tenant administrators and owners are the fixed access-administration
  // layer. Configurable post-house roles remain capability-driven below, but
  // an administrator must never lose essential recovery access because a
  // tenant policy row was removed or renamed.
  if (context.organization.role === "admin" || context.organization.role === "owner") return true;
  if (!context.person) return false;
  const policy = (await getTenantRolePolicies(context.organization.organizationId)).find((item) => item.role === context.person?.role);
  return policyGrants(normalized, context.organization.role, policy?.permissions);
}

/** Read-only operational observers can see the full facility plan, never mutate it. */
export async function canViewAllOperations() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "client" && await can("view_all_operations");
}

/**
 * Episode management is reserved for internal memberships. Tenant role policies
 * remain configurable, but a client membership never becomes a scheduling or
 * editorial-management account merely because a broad permission was assigned.
 */
export async function canManageEpisodes() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "client" && await can("manage_shows");
}

/** Facility scheduling and time-cost controls are internal post-house actions. */
export async function canManageBookings() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "client" && await can("manage_bookings");
}

export async function canRecordBookingActuals() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "client" && await can("update_assigned_work");
}

/** Workflow configuration belongs to a tenant capability, not the shows module. */
export async function canManageWorkflowConfiguration() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "client" && await can("manage_workflow_configuration");
}

/** A manager may update any accessible episode; artists may update only assigned work. */
export async function canUpdateWorkflowWork(episodeId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization || context.organization.role === "client") return false;
  if (await can("manage_workflow_stages")) return true;
  return await can("update_assigned_workflow_work") && await isAssignedToEpisode(episodeId);
}

/** Submission is deliberately separate from updating a track: finishing work
 * does not by itself allow someone to put it into the formal sign-off queue. */
export async function canSubmitWorkflowTrack(episodeId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization || context.organization.role === "client") return false;
  return await can("submit_workflow_stages") && await isAssignedToEpisode(episodeId);
}

/** Sign-off always additionally requires the episode-specific signer selection. */
export async function canSignOffWorkflowTrack(episodeId: string) {
  return await can("sign_off_workflow_stages") && await isAssignedToEpisode(episodeId);
}

/**
 * Managers can view every episode, except client memberships. Clients are always
 * limited to episodes where they are part of the episode team (or hold one of
 * the legacy episode assignment fields).
 */
export async function isAssignedToEpisode(episodeId: string) {
  const context = await getActiveOrganizationContext();
  const current = context?.person;
  if (!context?.organization || !current || !db) return false;
  if (context.organization.role !== "client" && ((await can("manage_shows")) || (await can("manage_workflow_stages")) || (await can("view_all_operations")))) return true;
  const [assignment] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .leftJoin(episodeTeamAssignments, and(
      eq(episodeTeamAssignments.organizationId, context.organization.organizationId),
      eq(episodeTeamAssignments.episodeId, episodes.id),
    ))
    .where(and(
      eq(episodes.id, episodeId),
      eq(episodes.organizationId, context.organization.organizationId),
      or(
        eq(episodes.editorId, current.id),
        eq(episodes.coloristId, current.id),
        eq(episodes.soundMixerId, current.id),
        eq(episodes.assignedProducerId, current.id),
        eq(episodeTeamAssignments.personId, current.id),
      ),
    ))
    .limit(1);
  return Boolean(assignment);
}

/** The least-privileged landing page is selected from capabilities, never a role name. */
export async function roleHome() {
  if (await can("view_all_operations")) return "/";
  if (await can("manage_catering")) return "/runner";
  if (await can("manage_budget")) return "/budget";
  return "/episodes";
}
