/**
 * Dependency-free tenant permission rules. Keep this module free of Next.js,
 * database, and session imports so policy behaviour can be verified directly.
 */
export const permissions = ["manage_settings", "manage_production", "do_assigned_work", "sign_off_work", "manage_qc_delivery", "manage_commercial", "manage_catering", "view_all_operations"] as const;
export type Permission = (typeof permissions)[number];
export type TenantRolePolicy = { role: string; label: string; permissions: Permission[] };
export const clientRolePolicy: TenantRolePolicy = { role: "client", label: "Client", permissions: ["sign_off_work"] };

const legacyPermissionMap: Record<string, Permission> = {
  manage_shows: "manage_production", manage_bookings: "manage_production", manage_work_orders: "manage_production", approve_work_orders: "manage_production", manage_workflow_configuration: "manage_settings", manage_workflow_stages: "manage_production", authorize_early_starts: "manage_production", manage_users: "manage_settings", manage_rates: "manage_commercial", manage_budget: "manage_commercial", approve_budget_overruns: "manage_commercial", approve_rate_overrides: "manage_commercial", manage_qc: "manage_qc_delivery", verify_qc: "manage_qc_delivery", waive_qc: "manage_qc_delivery", manage_delivery_profiles: "manage_qc_delivery", manage_episode_manifests: "manage_qc_delivery", update_delivery_items: "manage_qc_delivery", confirm_delivery_receipt: "manage_qc_delivery", authorize_delivery_exceptions: "manage_qc_delivery", manage_catering: "manage_catering", request_catering: "do_assigned_work", update_assigned_work: "do_assigned_work", update_assigned_workflow_work: "do_assigned_work", submit_workflow_stages: "do_assigned_work", sign_off_workflow_stages: "sign_off_work", view_assigned: "do_assigned_work", view_shared_delivery_status: "sign_off_work", manage_workflow_tracks: "manage_production", submit_workflow_tracks: "do_assigned_work", sign_off_workflow_tracks: "sign_off_work", authorize_workflow_exceptions: "manage_production",
};

export function normalizePermission(permission: string): Permission | null {
  const normalized = legacyPermissionMap[permission] ?? permission;
  return permissions.includes(normalized as Permission) ? normalized as Permission : null;
}

export function normalizePermissions(values: readonly string[]): Permission[] {
  return [...new Set(values.map(normalizePermission).filter((permission): permission is Permission => Boolean(permission)))];
}

export function policyGrants(permission: string, membershipRole: string, policyPermissions: readonly string[] | null | undefined) {
  const normalized = normalizePermission(permission);
  if (!normalized) return false;
  if (membershipRole === "client") return clientRolePolicy.permissions.includes(normalized);
  return normalizePermissions(policyPermissions ?? []).includes(normalized);
}
