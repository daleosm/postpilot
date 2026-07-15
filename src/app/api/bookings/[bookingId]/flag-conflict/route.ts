import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { bookings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canRecordBookingActuals } from "@/lib/permissions";

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!(await canRecordBookingActuals())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = z.object({ reason: z.string().trim().min(3).max(1000) }).safeParse(await request.json()); if (!body.success) return NextResponse.json({ error: "Explain the conflict." }, { status: 400 });
  const context = await getActiveOrganizationContext(); if (!context?.organization || !context.person) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const { bookingId } = await params;
  const [booking] = await getDb().select({ id: bookings.id, personId: bookings.personId, episodeId: bookings.episodeId, title: bookings.title }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId))).limit(1);
  if (!booking || booking.personId !== context.person.id) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "booking.conflict_flagged", entityType: "booking", entityId: booking.id, metadata: { episodeId: booking.episodeId, reason: body.data.reason, recipientPersonIds: [booking.personId], notificationTitle: "Booking conflict flagged", notificationBody: `${booking.title}: ${body.data.reason}` } });
  return NextResponse.json({ flagged: true });
}
