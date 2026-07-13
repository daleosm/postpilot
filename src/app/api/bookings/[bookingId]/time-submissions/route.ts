import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { bookingTimeSubmissions, bookings } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const schema = z.object({ actualStartsAt: z.coerce.date(), actualEndsAt: z.coerce.date(), overtimeMinutes: z.coerce.number().int().min(0).max(720).default(0), note: z.string().trim().max(2000).nullable().optional() }).refine((value) => value.actualEndsAt > value.actualStartsAt, { path: ["actualEndsAt"], message: "Actual end must be after actual start." });

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!(await can("update_assigned_work"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Enter valid actual hours." }, { status: 400 });
  const context = await getActiveOrganizationContext(); if (!context?.organization || !context.person) return NextResponse.json({ error: "No active person record." }, { status: 401 });
  const { bookingId } = await params; const db = getDb();
  const [booking] = await db.select({ id: bookings.id, personId: bookings.personId }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, context.organization.organizationId))).limit(1);
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (booking.personId !== context.person.id) return NextResponse.json({ error: "You can only confirm time for your own booking." }, { status: 403 });
  const [pending] = await db.select({ id: bookingTimeSubmissions.id }).from(bookingTimeSubmissions).where(and(
    eq(bookingTimeSubmissions.organizationId, context.organization.organizationId),
    eq(bookingTimeSubmissions.bookingId, bookingId),
    eq(bookingTimeSubmissions.submittedByPersonId, context.person.id),
    eq(bookingTimeSubmissions.status, "pending"),
  )).limit(1);
  if (pending) return NextResponse.json({ error: "Actual time is already awaiting approval for this booking." }, { status: 409 });
  const [submission] = await db.insert(bookingTimeSubmissions).values({ ...parsed.data, organizationId: context.organization.organizationId, bookingId, submittedByPersonId: context.person.id }).returning({ id: bookingTimeSubmissions.id, status: bookingTimeSubmissions.status });
  return NextResponse.json(submission, { status: 201 });
}
