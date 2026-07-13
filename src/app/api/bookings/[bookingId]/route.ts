import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getBookingSuggestions } from "@/lib/booking-conflicts";
import { getDb } from "@/lib/db";
import { bookings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { bookingRequestSchema } from "@/lib/validations/entities";
import { writeAuditEvent } from "@/lib/audit";

/** Updates a booking only after resolving it inside the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!(await can("manage_bookings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { bookingId } = await params;
  const parsed = bookingRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the booking details and try again." }, { status: 400 });

  const db = getDb();
  const [existing] = await db.select({ id: bookings.id, title: bookings.title, startsAt: bookings.startsAt, endsAt: bookings.endsAt, roomId: bookings.roomId, personId: bookings.personId, episodeId: bookings.episodeId }).from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId))).limit(1);
  if (!existing) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  const missing = await missingTenantReferences(context.organization.organizationId, {
    roomId: parsed.data.roomId,
    episodeId: parsed.data.episodeId,
    personId: parsed.data.personId,
    contactId: parsed.data.clientContactId,
  });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this organization.` }, { status: 404 });

  const availability = parsed.data.status === "cancelled" ? { conflicts: [] } : await getBookingSuggestions(context.organization.organizationId, { ...parsed.data, excludeId: bookingId });
  if (availability.conflicts.length) return NextResponse.json({ error: "This room or artist already has a conflicting booking.", ...availability }, { status: 409 });

  const [booking] = await db.update(bookings).set(parsed.data)
    .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId)))
    .returning({ id: bookings.id });
  const changed = existing.startsAt.getTime() !== parsed.data.startsAt.getTime() || existing.endsAt.getTime() !== parsed.data.endsAt.getTime() || existing.roomId !== parsed.data.roomId || existing.personId !== parsed.data.personId;
  if (changed) await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "booking.changed", entityType: "booking", entityId: bookingId, metadata: { episodeId: existing.episodeId, from: { startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt.toISOString(), roomId: existing.roomId, personId: existing.personId }, to: { startsAt: parsed.data.startsAt.toISOString(), endsAt: parsed.data.endsAt.toISOString(), roomId: parsed.data.roomId, personId: parsed.data.personId }, recipientPersonIds: [existing.personId, parsed.data.personId].filter(Boolean), notificationTitle: "Booking changed", notificationBody: `${existing.title} was moved or reassigned.` } });
  return NextResponse.json(booking);
}
