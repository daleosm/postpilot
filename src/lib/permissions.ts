import { and, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { episodeTeamAssignments, episodes, organizationRolePolicies } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";

/**
 * Tenant policy capabilities. These deliberately describe an action, rather
 * than a post-production job title. A post house can therefore give the same
 * authority to any of its own roles without changing workflow code.
 */
export const permissions = ["manage_settings", "manage_production", "do_assigned_work", "sign_off_work", "manage_qc_delivery", "manage_commercial", "manage_catering", "view_all_operations"] as const;
export type Permission = string;
export type TenantRolePolicy = { role: string; label: string; permissions: Permission[] };
export const clientRolePolicy: TenantRolePolicy = { role: "client", label: "Client", permissions: ["sign_off_work"] };
export const isFixedRole = (role: string) => role === clientRolePolicy.role;

/**
 * A short-lived compatibility bridge for policies saved before stages became
 * the sole workflow model. The migration rewrites persisted policies, while
 * this prevents an older tenant backup from accidentally losing access during
 * a staged deployment.
 */
const legacyPermissionMap: Record<string, Permission> = {
  manage_shows: "manage_production", manage_bookings: "manage_production", manage_work_orders: "manage_production", approve_work_orders: "manage_production", manage_workflow_configuration: "manage_settings", manage_workflow_stages: "manage_production", authorize_early_starts: "manage_production", manage_users: "manage_settings", manage_rates: "manage_commercial", manage_budget: "manage_commercial", approve_budget_overruns: "manage_commercial", approve_rate_overrides: "manage_commercial", manage_qc: "manage_qc_delivery", verify_qc: "manage_qc_delivery", waive_qc: "manage_qc_delivery", manage_delivery_profiles: "manage_qc_delivery", manage_episode_manifests: "manage_qc_delivery", update_delivery_items: "manage_qc_delivery", confirm_delivery_receipt: "manage_qc_delivery", authorize_delivery_exceptions: "manage_qc_delivery", manage_catering: "manage_catering", request_catering: "do_assigned_work", update_assigned_work: "do_assigned_work", update_assigned_workflow_work: "do_assigned_work", submit_workflow_stages: "do_assigned_work", sign_off_workflow_stages: "sign_off_work", view_assigned: "do_assigned_work", view_shared_delivery_status: "sign_off_work", manage_workflow_tracks: "manage_production", submit_workflow_tracks: "do_assigned_work", sign_off_workflow_tracks: "sign_off_work", authorize_workflow_exceptions: "manage_production",
};

function normalizePermission(permission: string): Permission | null {
  const normalized = legacyPermissionMap[permission] ?? permission;
  return permissions.includes(normalized as (typeof permissions)[number]) ? normalized : null;
}

function normalizePermissions(values: readonly string[]): Permission[] {
  return [...new Set(values.map(normalizePermission).filter((permission): permission is Permission => Boolean(permission)))];
}

/** Roles are tenant data, apart from the fixed external Guest role. */
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
  if (context.organization.role === "client") return clientRolePolicy.permissions.includes(normalized);
  if (!context.person) return false;
  const policy = (await getTenantRolePolicies(context.organization.organizationId)).find((item) => item.role === context.person?.role);
  return policy?.permissions.includes(normalized) ?? false;
}

/**
 * Episode management is reserved for internal memberships. Tenant role policies
 * remain configurable, but a guest membership never becomes a scheduling or
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
 * Managers can view every episode, except guest memberships. Guests are always
 * limited to episodes where they are part of the episode team (or hold one of
 * the legacy episode assignment fields).
 */
export async function isAssignedToEpisode(episodeId: string) {
  const context = await getActiveOrganizationContext();
  const current = context?.person;
  if (!context?.organization || !current || !db) return false;
  if (context.organization.role !== "client" && ((await can("manage_shows")) || (await can("manage_workflow_stages")))) return true;
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
