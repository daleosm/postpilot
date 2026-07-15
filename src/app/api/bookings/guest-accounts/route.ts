import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { episodeTeamAssignments, organizationMembers, people, users } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageBookings } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { createBookingGuestSchema } from "@/lib/validations/entities";

/** Creates a tenant-local guest account and immediately shares the selected episode with them. */
export async function POST(request: Request) {
  if (!(await canManageBookings())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = createBookingGuestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the guest account details." }, { status: 400 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "No active post house." }, { status: 401 });
  const organizationId = context.organization.organizationId;
  // Booking-created accounts are deliberately always external guest accounts.
  // Their episode assignment limits what they can access; a scheduler cannot
  // accidentally create an internal post-house role from this compact form.
  const input = { ...parsed.data, email: parsed.data.email.toLowerCase().trim(), personRole: "guest" };
  if ((await missingTenantReferences(organizationId, { episodeId: input.episodeId })).length) return NextResponse.json({ error: "Episode not found for this post house." }, { status: 404 });

  const db = getDb();
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  const userId = existingUser?.id ?? randomUUID();
  const [[membership], [existingPerson]] = await Promise.all([
    db.select({ userId: organizationMembers.userId }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId))).limit(1),
    db.select({ id: people.id, userId: people.userId }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.email, input.email))).limit(1),
  ]);
  if (membership) return NextResponse.json({ error: "This person already has access to this post house. Search for their guest account instead." }, { status: 409 });
  if (existingPerson?.userId && existingPerson.userId !== userId) return NextResponse.json({ error: "This email is already linked to a different tenant account." }, { status: 409 });

  const person = await db.transaction(async (tx) => {
    if (!existingUser) await tx.insert(users).values({ id: userId, name: input.name, email: input.email });
    await tx.insert(organizationMembers).values({ organizationId, userId, role: "guest" });
    const [guest] = existingPerson
      ? await tx.update(people).set({ userId, name: input.name, role: input.personRole, isActive: true, updatedAt: new Date() }).where(and(eq(people.id, existingPerson.id), eq(people.organizationId, organizationId))).returning({ id: people.id, name: people.name, role: people.role, email: people.email })
      : await tx.insert(people).values({ organizationId, userId, name: input.name, email: input.email, role: input.personRole }).returning({ id: people.id, name: people.name, role: people.role, email: people.email });
    const [assignment] = await tx.select({ id: episodeTeamAssignments.id }).from(episodeTeamAssignments).where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.episodeId, input.episodeId), eq(episodeTeamAssignments.personId, guest.id))).limit(1);
    if (!assignment) await tx.insert(episodeTeamAssignments).values({ organizationId, episodeId: input.episodeId, personId: guest.id, responsibility: guest.role, isLead: false });
    return guest;
  });

  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "booking.guest_account_created", entityType: "person", entityId: person.id, metadata: { episodeId: input.episodeId, email: input.email, role: person.role } });
  return NextResponse.json(person, { status: 201 });
}
