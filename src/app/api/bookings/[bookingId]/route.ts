import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { findBookingConflicts } from "@/lib/booking-conflicts";
import { getDb } from "@/lib/db";
import { bookings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { bookingRequestSchema } from "@/lib/validations/entities";

/** Updates a booking only after resolving it inside the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!(await can("manage_bookings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { bookingId } = await params;
  const parsed = bookingRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the booking details and try again." }, { status: 400 });

  const db = getDb();
  const [existing] = await db.select({ id: bookings.id }).from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId))).limit(1);
  if (!existing) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  const missing = await missingTenantReferences(context.organization.organizationId, {
    roomId: parsed.data.roomId,
    episodeId: parsed.data.episodeId,
    personId: parsed.data.personId,
  });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this organization.` }, { status: 404 });

  const conflicts = parsed.data.status === "cancelled" ? [] : await findBookingConflicts(context.organization.organizationId, { ...parsed.data, excludeId: bookingId });
  if (conflicts.length) return NextResponse.json({ error: "This room or artist already has a conflicting booking.", conflicts }, { status: 409 });

  const [booking] = await db.update(bookings).set(parsed.data)
    .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId)))
    .returning({ id: bookings.id });
  return NextResponse.json(booking);
}
