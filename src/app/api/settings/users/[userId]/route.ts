import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { organizationMembers, organizationRolePolicies, people } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { updateOrganizationUserSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await can("manage_users"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateOrganizationUserSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the access details." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "No active post house." }, { status: 401 });
  const { userId } = await params;
  if (userId === context.userId && parsed.data.membershipRole !== "admin") return NextResponse.json({ error: "You cannot remove your own administrator access." }, { status: 409 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [[membership], [policy]] = await Promise.all([
    db.select({ userId: organizationMembers.userId, membershipRole: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId))).limit(1),
    db.select({ role: organizationRolePolicies.role }).from(organizationRolePolicies).where(and(eq(organizationRolePolicies.organizationId, organizationId), eq(organizationRolePolicies.role, parsed.data.personRole))).limit(1),
  ]);
  if (!membership) return NextResponse.json({ error: "User not found in this post house." }, { status: 404 });
  if (membership.membershipRole === "owner") return NextResponse.json({ error: "The post-house owner access cannot be changed here." }, { status: 403 });
  if (!policy) return NextResponse.json({ error: "Select a role configured for this post house." }, { status: 400 });

  await db.transaction(async (tx) => {
    await tx.update(organizationMembers).set({ role: parsed.data.membershipRole }).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
    await tx.update(people).set({ role: parsed.data.personRole, updatedAt: new Date() }).where(and(eq(people.organizationId, organizationId), eq(people.userId, userId)));
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "organization.user_access_updated", entityType: "user", entityId: userId, metadata: parsed.data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await can("manage_users"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "No active post house." }, { status: 401 });
  const { userId } = await params;
  if (userId === context.userId) return NextResponse.json({ error: "You cannot remove your own access." }, { status: 409 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [membership] = await db.select({ userId: organizationMembers.userId, membershipRole: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId))).limit(1);
  if (!membership) return NextResponse.json({ error: "User not found in this post house." }, { status: 404 });
  if (membership.membershipRole === "owner") return NextResponse.json({ error: "The post-house owner access cannot be removed here." }, { status: 403 });
  await db.transaction(async (tx) => {
    await tx.delete(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
    await tx.update(people).set({ userId: null, isActive: false, updatedAt: new Date() }).where(and(eq(people.organizationId, organizationId), eq(people.userId, userId)));
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "organization.user_access_removed", entityType: "user", entityId: userId });
  return NextResponse.json({ ok: true });
}
