import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { organizationRolePolicies, people } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, clientRolePolicy, isFixedRole, permissions } from "@/lib/permissions";
import { updateOrganizationRolePoliciesSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request) {
  if (!(await can("manage_users"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateOrganizationRolePoliciesSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the role settings." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const allowedPermissions = new Set<string>(permissions);
  const rolePattern = /^[a-z0-9_]+$/;
  if (parsed.data.policies.some((policy) => !rolePattern.test(policy.role) || policy.permissions.some((permission) => !allowedPermissions.has(permission))) || new Set(parsed.data.policies.map((policy) => policy.role)).size !== parsed.data.policies.length) return NextResponse.json({ error: "Role settings contain a duplicate or unsupported role or permission." }, { status: 400 });
  const submittedClient = parsed.data.policies.find((policy) => isFixedRole(policy.role));
  if (submittedClient && (submittedClient.label !== clientRolePolicy.label || submittedClient.permissions.length !== clientRolePolicy.permissions.length || submittedClient.permissions.some((permission) => !clientRolePolicy.permissions.includes(permission as typeof clientRolePolicy.permissions[number])))) return NextResponse.json({ error: "Client is a fixed system role and its permissions cannot be changed." }, { status: 400 });
  const policies = parsed.data.policies.filter((policy) => !isFixedRole(policy.role));
  const db = getDb();
  const organizationId = context.organization.organizationId;
  const assignedRoles = await db.select({ role: people.role }).from(people).where(eq(people.organizationId, organizationId));
  const configuredRoles = new Set([clientRolePolicy.role, ...policies.map((policy) => policy.role)]);
  const removedInUse = [...new Set(assignedRoles.map((person) => person.role))].find((role) => !configuredRoles.has(role));
  if (removedInUse) return NextResponse.json({ error: `Reassign people using the ${removedInUse.replaceAll("_", " ")} role before removing it.` }, { status: 409 });
  await db.transaction(async (tx) => {
    await tx.delete(organizationRolePolicies).where(eq(organizationRolePolicies.organizationId, organizationId));
    await tx.insert(organizationRolePolicies).values(policies.map((policy) => ({ organizationId, role: policy.role, label: policy.label, permissions: policy.permissions })));
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "organization.role_policies_updated", entityType: "organization", entityId: organizationId, metadata: { roleCount: policies.length } });
  return NextResponse.json({ ok: true });
}
