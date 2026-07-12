import { NextResponse } from "next/server";

import { findBookingConflicts } from "@/lib/booking-conflicts";
import { getDb } from "@/lib/db";
import { bookings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { bookingRequestSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_bookings"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-booking", debug: true }, { status: 201 });
  const parsed = bookingRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the booking details and try again." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const missing = await missingTenantReferences(context.organization.organizationId, { roomId: parsed.data.roomId, episodeId: parsed.data.episodeId, personId: parsed.data.personId });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this organization.` }, { status: 404 });
  const conflicts = await findBookingConflicts(context.organization.organizationId, parsed.data);
  if (conflicts.length) return NextResponse.json({ error: "This room or artist already has a conflicting booking.", conflicts }, { status: 409 });
  const [booking] = await getDb().insert(bookings).values({ ...parsed.data, organizationId: context.organization.organizationId }).returning({ id: bookings.id });
  return NextResponse.json(booking, { status: 201 });
}
