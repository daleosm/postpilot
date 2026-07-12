import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { bookings, cateringRequests, people, rooms } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { createCateringRequestSchema } from "@/lib/validations/entities";
import { missingTenantReferences } from "@/lib/tenant-resources";

export async function POST(request: Request) {
  if (!(await can("request_catering"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = createCateringRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the request details and room or booking." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: `demo-catering-${Date.now()}`, debug: true }, { status: 201 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const missing = await missingTenantReferences(context.organization.organizationId, { bookingId: parsed.data.bookingId, roomId: parsed.data.roomId });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this organization.` }, { status: 404 });
  const [[person], [booking], [room]] = await Promise.all([
    db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1),
    parsed.data.bookingId ? db.select({ id: bookings.id, roomId: bookings.roomId }).from(bookings).where(and(eq(bookings.id, parsed.data.bookingId), eq(bookings.organizationId, context.organization.organizationId))).limit(1) : Promise.resolve([]),
    parsed.data.roomId ? db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, parsed.data.roomId), eq(rooms.organizationId, context.organization.organizationId))).limit(1) : Promise.resolve([]),
  ]);
  if (parsed.data.bookingId && !booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (!booking && parsed.data.roomId && !room) return NextResponse.json({ error: "Room not found." }, { status: 404 });
  const [created] = await db.insert(cateringRequests).values({ ...parsed.data, organizationId: context.organization.organizationId, roomId: booking?.roomId ?? parsed.data.roomId ?? null, requestedByPersonId: person?.id ?? null }).returning({ id: cateringRequests.id });
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "catering.requested", entityType: "catering_request", entityId: created.id, metadata: { type: parsed.data.requestType, item: parsed.data.item } });
  return NextResponse.json(created, { status: 201 });
}
