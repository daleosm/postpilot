import { and, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { episodes, organizationRolePolicies } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";

export const permissions = ["manage_shows", "manage_bookings", "manage_reviews", "approve_reviews", "manage_work_orders", "update_assigned_work", "approve_time", "approve_budget_overruns", "manage_rates", "approve_rate_overrides", "approve_po_overruns", "manage_qc", "verify_qc", "waive_qc", "manage_budget", "request_catering", "manage_catering", "view_assigned"] as const;
export type Permission = (typeof permissions)[number];
export type TenantRolePolicy = { role: string; label: string; permissions: Permission[] };

/** Roles are tenant data. There is deliberately no built-in role list or role-to-permission fallback. */
export async function getTenantRolePolicies(organizationId: string): Promise<TenantRolePolicy[]> {
  if (!db) return [];
  const policies = await db.select({ role: organizationRolePolicies.role, label: organizationRolePolicies.label, permissions: organizationRolePolicies.permissions })
    .from(organizationRolePolicies).where(eq(organizationRolePolicies.organizationId, organizationId));
  return policies.map((policy) => ({ role: policy.role, label: policy.label, permissions: policy.permissions.filter((permission): permission is Permission => permissions.includes(permission as Permission)) }));
}

export async function getCurrentPerson() {
  const context = await getActiveOrganizationContext();
  return context?.person ?? null;
}

export async function can(permission: Permission) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return false;
  if (["owner", "admin"].includes(context.organization.role ?? "")) return true;
  if (!context.person) return false;
  const policy = (await getTenantRolePolicies(context.organization.organizationId)).find((item) => item.role === context.person?.role);
  return policy?.permissions.includes(permission) ?? false;
}

/** A manager can view every episode; everyone else must be explicitly episode-assigned. */
export async function isAssignedToEpisode(episodeId: string) {
  const context = await getActiveOrganizationContext();
  const current = context?.person;
  if (!context?.organization || !current || !db) return false;
  if (await can("manage_shows")) return true;
  const [assignment] = await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, context.organization.organizationId), or(eq(episodes.editorId, current.id), eq(episodes.coloristId, current.id), eq(episodes.soundMixerId, current.id), eq(episodes.assignedProducerId, current.id)))).limit(1);
  return Boolean(assignment);
}

/** The least-privileged landing page is selected from capabilities, never a role name. */
export async function roleHome() {
  if (await can("manage_catering")) return "/runner";
  if (await can("manage_budget")) return "/budget";
  if ((await can("approve_reviews")) || (await can("update_assigned_work"))) return "/review";
  return "/episodes";
}
