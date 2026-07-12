import { and, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { episodes, organizationRolePolicies, tasks } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";

export const permissions = ["manage_shows", "manage_bookings", "manage_reviews", "approve_reviews", "update_notes", "update_tasks", "manage_deliverables", "manage_budget", "request_catering", "manage_catering", "view_assigned"] as const;
export type Permission = (typeof permissions)[number];

export const roleDefinitions = [
  { role: "post_supervisor", label: "Post supervisor" },
  { role: "producer", label: "Producer" },
  { role: "head_of_production", label: "Head of production" },
  { role: "editor", label: "Editor" },
  { role: "assistant_editor", label: "Assistant editor" },
  { role: "online_editor", label: "Online editor" },
  { role: "colorist", label: "Colorist" },
  { role: "sound_mixer", label: "Sound mixer" },
  { role: "supervising_sound_editor", label: "Supervising sound editor" },
  { role: "rerecording_mixer", label: "Re-recording mixer" },
  { role: "vfx_coordinator", label: "VFX coordinator" },
  { role: "vfx_supervisor", label: "VFX supervisor" },
  { role: "qc", label: "QC operator" },
  { role: "director", label: "Director" },
  { role: "network", label: "Network reviewer" },
  { role: "network_client_executive", label: "Network / client executive" },
  { role: "network_client_representative", label: "Network / client representative" },
  { role: "client", label: "Client reviewer" },
  { role: "finance", label: "Finance" },
  { role: "runner", label: "Runner" },
  { role: "freelancer", label: "Freelancer" },
] as const;

export type TenantRolePolicy = { role: string; label: string; permissions: Permission[] };

const artists = new Set(["editor", "assistant_editor", "online_editor", "colorist", "sound_mixer", "supervising_sound_editor", "rerecording_mixer", "qc", "vfx_coordinator", "vfx_supervisor"]);
const externalReviewers = new Set(["client", "director", "network", "network_client_executive", "network_client_representative"]);
// Runner desk is intentionally excluded from the general production default.
// It exposes floor-hospitality fulfilment, which belongs to runners (and tenant
// admins), not producers or post supervisors unless explicitly configured.
const allProductionPermissions: Permission[] = ["manage_shows", "manage_bookings", "manage_reviews", "approve_reviews", "update_notes", "update_tasks", "manage_deliverables", "manage_budget", "request_catering", "view_assigned"];
const artistPermissions: Permission[] = ["view_assigned", "update_notes", "update_tasks", "request_catering"];

export function defaultPermissionsForRole(role: string | undefined): Permission[] {
  if (["producer", "post_supervisor"].includes(role ?? "")) return allProductionPermissions;
  if (role === "head_of_production") return ["manage_shows", "manage_bookings", "manage_budget", "request_catering", "view_assigned"];
  if (role === "finance") return ["manage_budget", "view_assigned"];
  if (role && artists.has(role)) return artistPermissions;
  if (role === "runner") return ["request_catering", "manage_catering", "view_assigned"];
  if (role && externalReviewers.has(role)) return ["approve_reviews", "update_notes", "view_assigned"];
  return [];
}

export async function getTenantRolePolicies(organizationId: string): Promise<TenantRolePolicy[]> {
  const overrides = db ? await db.select({ role: organizationRolePolicies.role, label: organizationRolePolicies.label, permissions: organizationRolePolicies.permissions })
    .from(organizationRolePolicies).where(eq(organizationRolePolicies.organizationId, organizationId)) : [];
  if (overrides.length) return overrides.map((policy) => ({ role: policy.role, label: policy.label, permissions: policy.permissions.filter((permission): permission is Permission => permissions.includes(permission as Permission)) }));
  return roleDefinitions.map((definition) => ({ role: definition.role, label: definition.label, permissions: defaultPermissionsForRole(definition.role) }));
}

export async function getCurrentPerson() {
  const context = await getActiveOrganizationContext();
  return context?.person ?? null;
}

export async function can(permission: Permission) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return isDebugDemoMode ? defaultPermissionsForRole(context?.person?.role).includes(permission) : false;
  if (["owner", "admin"].includes(context.organization.role ?? "")) return true;
  const policy = (await getTenantRolePolicies(context.organization.organizationId)).find((item) => item.role === context.person?.role);
  return (policy?.permissions ?? defaultPermissionsForRole(context.person?.role)).includes(permission);
}

/** An artist may submit workflow work only on an episode they are assigned to or tasked on. */
export async function isAssignedToEpisode(episodeId: string) {
  if (isDebugDemoMode) return true;
  const context = await getActiveOrganizationContext();
  const current = context?.person;
  if (!context?.organization || !current || !db) return false;
  if (["producer", "post_supervisor", "head_of_production"].includes(current.role)) return true;
  const [assignment] = await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, context.organization.organizationId), or(eq(episodes.editorId, current.id), eq(episodes.coloristId, current.id), eq(episodes.soundMixerId, current.id), eq(episodes.assignedProducerId, current.id)))).limit(1);
  if (assignment) return true;
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.organizationId, context.organization.organizationId), eq(tasks.episodeId, episodeId), eq(tasks.assigneeId, current.id))).limit(1);
  return Boolean(task);
}

export function isExternalReviewerRole(role: string | undefined) {
  return Boolean(role && externalReviewers.has(role));
}

/** The least-privileged landing page when a role is sent to a guarded route. */
export function roleHome(role: string | undefined) {
  if (isExternalReviewerRole(role)) return "/review";
  if (role === "finance") return "/budget";
  if (role === "runner") return "/catering";
  return "/episodes";
}
