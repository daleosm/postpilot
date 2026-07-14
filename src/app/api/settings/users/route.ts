import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { organizationMembers, organizationRolePolicies, people, users } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { createOrganizationUserSchema } from "@/lib/validations/entities";

/** Creates tenant access plus a tenant-local person record. The global user row is reused by email when appropriate. */
export async function POST(request: Request) {
  if (!(await can("manage_users"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = createOrganizationUserSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the user details." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "No active post house." }, { status: 401 });

  const organizationId = context.organization.organizationId;
  const input = { ...parsed.data, email: parsed.data.email.toLowerCase().trim() };
  const db = getDb();
  const [policy] = await db.select({ role: organizationRolePolicies.role }).from(organizationRolePolicies)
    .where(and(eq(organizationRolePolicies.organizationId, organizationId), eq(organizationRolePolicies.role, input.personRole))).limit(1);
  if (!policy) return NextResponse.json({ error: "Select a role configured for this post house." }, { status: 400 });

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  const userId = existingUser?.id ?? randomUUID();
  const [[membership], [existingPerson]] = await Promise.all([
    db.select({ userId: organizationMembers.userId }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId))).limit(1),
    db.select({ id: people.id, userId: people.userId }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.email, input.email))).limit(1),
  ]);
  if (membership) return NextResponse.json({ error: "This person already has access to this post house." }, { status: 409 });
  if (existingPerson?.userId && existingPerson.userId !== userId) return NextResponse.json({ error: "This work email is already linked to a different tenant account." }, { status: 409 });

  await db.transaction(async (tx) => {
    if (!existingUser) await tx.insert(users).values({ id: userId, name: input.name, email: input.email });
    await tx.insert(organizationMembers).values({ organizationId, userId, role: input.membershipRole });
    if (existingPerson) {
      await tx.update(people).set({ userId, name: input.name, role: input.personRole, isActive: true, updatedAt: new Date() })
        .where(and(eq(people.id, existingPerson.id), eq(people.organizationId, organizationId)));
    } else {
      await tx.insert(people).values({ organizationId, userId, name: input.name, email: input.email, role: input.personRole });
    }
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "organization.user_added", entityType: "user", entityId: userId, metadata: { email: input.email, personRole: input.personRole, membershipRole: input.membershipRole } });
  return NextResponse.json({ id: userId }, { status: 201 });
}
