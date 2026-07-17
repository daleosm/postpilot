import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit";
import { getBookingSuggestions } from "@/lib/booking-conflicts";
import { getDb } from "@/lib/db";
import { bookings, postWorkOrders, rooms } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canManageBookings, canRecordBookingActuals } from "@/lib/permissions";

const scheduleSchema = z.object({
  roomId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  notes: z.string().trim().max(2_000).nullable().optional(),
}).refine((value) => value.endsAt > value.startsAt, { path: ["endsAt"], message: "End must be after start." });

const bookingTypeForRoom: Record<string, "edit" | "color" | "mix" | "qc"> = {
  edit_bay: "edit", color_suite: "color", mix_room: "mix", qc_room: "qc",
};

/** Reserve a facility slot for an in-progress internal work order. */
export async function POST(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  const [mayManage, mayRecord] = await Promise.all([canManageBookings(), canRecordBookingActuals()]);
  if (!mayManage && !mayRecord) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = scheduleSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid room and time window." }, { status: 400 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization || !context.person) return NextResponse.json({ error: "No active person record." }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { workOrderId } = await params;
  const db = getDb();
  const [workOrder] = await db.select({
    id: postWorkOrders.id, episodeId: postWorkOrders.episodeId, title: postWorkOrders.title, status: postWorkOrders.status,
    workType: postWorkOrders.workType, assigneePersonId: postWorkOrders.assigneePersonId, assigneeRole: postWorkOrders.assigneeRole, bookingId: postWorkOrders.bookingId,
  }).from(postWorkOrders).where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId))).limit(1);
  if (!workOrder) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  const isAssigned = workOrder.assigneePersonId === context.person.id || workOrder.assigneeRole === context.person.role;
  if (!mayManage && !isAssigned) return NextResponse.json({ error: "You can only schedule work assigned to you." }, { status: 403 });
  if (workOrder.workType !== "internal") return NextResponse.json({ error: "Only internal work orders can reserve post-house rooms." }, { status: 409 });
  if (workOrder.status !== "in_progress") return NextResponse.json({ error: "Release this work order before reserving time." }, { status: 409 });
  if (workOrder.bookingId) {
    const [linkedBooking] = await db.select({ id: bookings.id, status: bookings.status }).from(bookings)
      .where(and(eq(bookings.id, workOrder.bookingId), eq(bookings.organizationId, organizationId))).limit(1);
    if (!linkedBooking || linkedBooking.status !== "cancelled") return NextResponse.json({ error: "This work order already has a calendar booking." }, { status: 409 });
  }

  const [room] = await db.select({ id: rooms.id, type: rooms.type, name: rooms.name }).from(rooms)
    .where(and(eq(rooms.id, parsed.data.roomId), eq(rooms.organizationId, organizationId))).limit(1);
  if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
  const bookingType = bookingTypeForRoom[room.type];
  if (!bookingType) return NextResponse.json({ error: "This room cannot be reserved for a work order." }, { status: 400 });

  const personId = workOrder.assigneePersonId ?? context.person.id;
  const availability = await getBookingSuggestions(organizationId, { roomId: room.id, personId, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt, bookingType, includeOptionBookings: false });
  if (availability.conflicts.length) return NextResponse.json({ error: "The room or assigned artist is already booked at this time.", ...availability }, { status: 409 });

  let booking: { id: string };
  try {
    [booking] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(bookings).values({
        organizationId, roomId: room.id, episodeId: workOrder.episodeId, personId,
        title: `Work order · ${workOrder.title}`.slice(0, 160), startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt,
        status: "confirmed", bookingType, notes: parsed.data.notes ?? "Reserved from assigned work order.",
      }).returning({ id: bookings.id });
      const [linked] = await tx.update(postWorkOrders).set({ bookingId: created.id, updatedAt: new Date() })
        .where(and(eq(postWorkOrders.id, workOrder.id), eq(postWorkOrders.organizationId, organizationId), workOrder.bookingId ? eq(postWorkOrders.bookingId, workOrder.bookingId) : isNull(postWorkOrders.bookingId)))
        .returning({ id: postWorkOrders.id });
      if (!linked) throw new ReservationAlreadyCreatedError();
      return [created];
    });
  } catch (error) {
    if (error instanceof ReservationAlreadyCreatedError) return NextResponse.json({ error: "This work order was just reserved by another booking." }, { status: 409 });
    throw error;
  }
  await Promise.all([
    writeAuditEvent({ organizationId, actorUserId: context.userId, action: "work_order.booking_scheduled", entityType: "post_work_order", entityId: workOrder.id, metadata: { bookingId: booking.id, roomId: room.id, roomName: room.name, episodeId: workOrder.episodeId, startsAt: parsed.data.startsAt.toISOString(), endsAt: parsed.data.endsAt.toISOString() } }),
    writeAuditEvent({ organizationId, actorUserId: context.userId, action: "booking.created_from_work_order", entityType: "booking", entityId: booking.id, metadata: { workOrderId: workOrder.id, episodeId: workOrder.episodeId } }),
  ]);
  return NextResponse.json({ ...booking, workOrderId: workOrder.id }, { status: 201 });
}

class ReservationAlreadyCreatedError extends Error {}
