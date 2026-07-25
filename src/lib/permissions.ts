import { getActiveOrganizationContext } from "@/lib/organizations";
import { clientRolePolicy, normalizePermission, type Permission, type TenantRolePolicy } from "@/lib/permissions-core";
import { getPostPilotApiSession, postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export { clientRolePolicy, normalizePermission, normalizePermissions, permissions, policyGrants } from "@/lib/permissions-core";
export type { Permission, TenantRolePolicy } from "@/lib/permissions-core";

/**
 * Tenant policy capabilities. These deliberately describe an action, rather
 * than a post-production job title. A post house can therefore give the same
 * authority to any of its own roles without changing workflow code.
 */
export const isFixedRole = (role: string) => role === clientRolePolicy.role;

/** Tenant policy records are always read through FastAPI. */
export async function getTenantRolePolicies(_organizationId?: string): Promise<TenantRolePolicy[]> {
  void _organizationId;
  const response = await postpilotApiServerFetch<{ policies: Array<{ role: string; label: string; permissions: string[] }> }>("/settings/bootstrap");
  return response.policies.map((policy) => ({ ...policy, permissions: policy.permissions as Permission[] }));
}

export async function getCurrentPerson() {
  const context = await getActiveOrganizationContext();
  return context?.person ?? null;
}

export async function can(permission: Permission | string) {
  const normalized = normalizePermission(permission);
  if (!normalized) return false;
  return (await getPostPilotApiSession())?.permissions.includes(normalized) ?? false;
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
  try {
    const access = await postpilotApiServerFetch<{ assigned: boolean }>(`/episodes/${episodeId}/access`);
    return access.assigned || await can("manage_shows") || await can("manage_workflow_stages") || await can("view_all_operations");
  } catch {
    return false;
  }
}

/** The least-privileged landing page is selected from capabilities, never a role name. */
export async function roleHome() {
  if (await can("view_all_operations")) return "/";
  if (await can("manage_catering")) return "/runner";
  if (await can("manage_budget")) return "/budget";
  return "/episodes";
}
