import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getBookingSuggestions } from "@/lib/booking-conflicts";
import { addGuestToEpisodeTeam, getGuestAccountForBooking } from "@/lib/booking-guests";
import { getDb } from "@/lib/db";
import { bookings } from "@/lib/db/schema";
import { isActiveOptionBooking, resequenceOptionBookings } from "@/lib/option-bookings";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageBookings } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { bookingRequestSchema } from "@/lib/validations/entities";
import { writeAuditEvent } from "@/lib/audit";

/** Updates a booking only after resolving it inside the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!(await canManageBookings())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { bookingId } = await params;
  const parsed = bookingRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the booking details and try again." }, { status: 400 });

  const db = getDb();
  const [existing] = await db.select({ id: bookings.id, title: bookings.title, startsAt: bookings.startsAt, endsAt: bookings.endsAt, setupMinutes: bookings.setupMinutes, handoverMinutes: bookings.handoverMinutes, isOption: bookings.isOption, status: bookings.status, roomId: bookings.roomId, personId: bookings.personId, episodeId: bookings.episodeId }).from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId))).limit(1);
  if (!existing) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  const missing = await missingTenantReferences(context.organization.organizationId, {
    roomId: parsed.data.roomId,
    episodeId: parsed.data.episodeId,
    personId: parsed.data.personId,
  });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this organization.` }, { status: 404 });
  const guest = parsed.data.guestPersonId ? await getGuestAccountForBooking(context.organization.organizationId, parsed.data.guestPersonId) : null;
  if (parsed.data.guestPersonId && !guest) return NextResponse.json({ error: "Guest account not found for this organization." }, { status: 404 });

  const values = parsed.data.isOption && parsed.data.status !== "cancelled" ? { ...parsed.data, status: "tentative" as const } : parsed.data;
  const availability = values.status === "cancelled" ? { conflicts: [] } : await getBookingSuggestions(context.organization.organizationId, { ...values, excludeId: bookingId, includeOptionBookings: values.isOption });
  if (!values.isOption && availability.conflicts.length) return NextResponse.json({ error: "This room or artist already has a conflicting booking.", ...availability }, { status: 409 });

  const [booking] = await db.update(bookings).set({ ...values, optionRank: isActiveOptionBooking(values) ? 0 : null })
    .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId)))
    .returning({ id: bookings.id });
  if (guest && parsed.data.episodeId) await addGuestToEpisodeTeam(context.organization.organizationId, parsed.data.episodeId, guest);
  if (isActiveOptionBooking(existing)) await resequenceOptionBookings(context.organization.organizationId, existing);
  if (isActiveOptionBooking(values)) await resequenceOptionBookings(context.organization.organizationId, values);
  const changed = existing.startsAt.getTime() !== values.startsAt.getTime() || existing.endsAt.getTime() !== values.endsAt.getTime() || existing.roomId !== values.roomId || existing.personId !== values.personId;
  if (changed) await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "booking.changed", entityType: "booking", entityId: bookingId, metadata: { episodeId: existing.episodeId, from: { startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt.toISOString(), roomId: existing.roomId, personId: existing.personId }, to: { startsAt: values.startsAt.toISOString(), endsAt: values.endsAt.toISOString(), roomId: values.roomId, personId: values.personId }, recipientPersonIds: [existing.personId, values.personId].filter(Boolean), notificationTitle: "Booking changed", notificationBody: `${existing.title} was moved or reassigned.` } });
  return NextResponse.json(booking);
}
