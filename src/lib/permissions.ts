import { and, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { episodeTeamAssignments, episodes, organizationRolePolicies } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";

/**
 * Tenant policy capabilities. These deliberately describe an action, rather
 * than a post-production job title. A post house can therefore give the same
 * authority to any of its own roles without changing workflow code.
 */
export const permissions = ["manage_shows", "manage_bookings", "manage_work_orders", "approve_work_orders", "update_assigned_work", "manage_workflow_configuration", "manage_workflow_stages", "update_assigned_workflow_work", "submit_workflow_stages", "sign_off_workflow_stages", "approve_budget_overruns", "manage_rates", "approve_rate_overrides", "manage_qc", "verify_qc", "waive_qc", "authorize_early_starts", "authorize_delivery_exceptions", "manage_delivery_profiles", "manage_episode_manifests", "update_delivery_items", "confirm_delivery_receipt", "view_shared_delivery_status", "manage_budget", "manage_users", "request_catering", "manage_catering", "view_assigned"] as const;
export type Permission = (typeof permissions)[number];
export type TenantRolePolicy = { role: string; label: string; permissions: Permission[] };
export const guestRolePolicy: TenantRolePolicy = { role: "guest", label: "Guest", permissions: ["view_assigned", "view_shared_delivery_status", "sign_off_workflow_stages"] };
export const isFixedRole = (role: string) => role === guestRolePolicy.role;

/**
 * A short-lived compatibility bridge for policies saved before stages became
 * the sole workflow model. The migration rewrites persisted policies, while
 * this prevents an older tenant backup from accidentally losing access during
 * a staged deployment.
 */
const legacyPermissionMap: Record<string, Permission> = {
  manage_workflow_tracks: "manage_workflow_stages",
  submit_workflow_tracks: "submit_workflow_stages",
  sign_off_workflow_tracks: "sign_off_workflow_stages",
  authorize_workflow_exceptions: "authorize_early_starts",
};

function normalizePermission(permission: string): Permission | null {
  const normalized = legacyPermissionMap[permission] ?? permission;
  return permissions.includes(normalized as Permission) ? normalized as Permission : null;
}

function normalizePermissions(values: readonly string[]): Permission[] {
  return [...new Set(values.map(normalizePermission).filter((permission): permission is Permission => Boolean(permission)))];
}

/** Roles are tenant data, apart from the fixed external Guest role. */
export async function getTenantRolePolicies(organizationId: string): Promise<TenantRolePolicy[]> {
  if (!db) return [guestRolePolicy];
  const policies = await db.select({ role: organizationRolePolicies.role, label: organizationRolePolicies.label, permissions: organizationRolePolicies.permissions })
    .from(organizationRolePolicies).where(eq(organizationRolePolicies.organizationId, organizationId));
  const configurable = policies.filter((policy) => !isFixedRole(policy.role)).map((policy) => ({ role: policy.role, label: policy.label, permissions: normalizePermissions(policy.permissions) }));
  return [guestRolePolicy, ...configurable];
}

export async function getCurrentPerson() {
  const context = await getActiveOrganizationContext();
  return context?.person ?? null;
}

export async function can(permission: Permission) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return false;
  if (context.organization.role === "guest") return guestRolePolicy.permissions.includes(permission);
  if (!context.person) return false;
  const policy = (await getTenantRolePolicies(context.organization.organizationId)).find((item) => item.role === context.person?.role);
  return policy?.permissions.includes(permission) ?? false;
}

/**
 * Episode management is reserved for internal memberships. Tenant role policies
 * remain configurable, but a guest membership never becomes a scheduling or
 * editorial-management account merely because a broad permission was assigned.
 */
export async function canManageEpisodes() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "guest" && await can("manage_shows");
}

/** Facility scheduling and time-cost controls are internal post-house actions. */
export async function canManageBookings() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "guest" && await can("manage_bookings");
}

export async function canRecordBookingActuals() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "guest" && await can("update_assigned_work");
}

/** Workflow configuration belongs to a tenant capability, not the shows module. */
export async function canManageWorkflowConfiguration() {
  const context = await getActiveOrganizationContext();
  return context?.organization?.role !== "guest" && await can("manage_workflow_configuration");
}

/** A manager may update any accessible episode; artists may update only assigned work. */
export async function canUpdateWorkflowWork(episodeId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization || context.organization.role === "guest") return false;
  if (await can("manage_workflow_stages")) return true;
  return await can("update_assigned_workflow_work") && await isAssignedToEpisode(episodeId);
}

/** Submission is deliberately separate from updating a track: finishing work
 * does not by itself allow someone to put it into the formal sign-off queue. */
export async function canSubmitWorkflowTrack(episodeId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization || context.organization.role === "guest") return false;
  return await can("submit_workflow_stages") && await isAssignedToEpisode(episodeId);
}

/** Sign-off always additionally requires the episode-specific signer selection. */
export async function canSignOffWorkflowTrack(episodeId: string) {
  return await can("sign_off_workflow_stages") && await isAssignedToEpisode(episodeId);
}

/**
 * Managers can view every episode, except guest memberships. Guests are always
 * limited to episodes where they are part of the episode team (or hold one of
 * the legacy episode assignment fields).
 */
export async function isAssignedToEpisode(episodeId: string) {
  const context = await getActiveOrganizationContext();
  const current = context?.person;
  if (!context?.organization || !current || !db) return false;
  if (context.organization.role !== "guest" && ((await can("manage_shows")) || (await can("manage_workflow_stages")))) return true;
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
  if (await can("manage_catering")) return "/runner";
  if (await can("manage_budget")) return "/budget";
  return "/episodes";
}
