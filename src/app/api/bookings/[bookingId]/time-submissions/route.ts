import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { bookings, budgetLines, episodes, seasons } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canRecordBookingActuals } from "@/lib/permissions";
import { getBookingCostProjection } from "@/server/data";

const schema = z.object({ actualStartsAt: z.coerce.date(), actualEndsAt: z.coerce.date(), overtimeMinutes: z.coerce.number().int().min(0).max(720).default(0), note: z.string().trim().max(2000).nullable().optional() }).refine((value) => value.actualEndsAt > value.actualStartsAt, { path: ["actualEndsAt"], message: "Actual end must be after actual start." });

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!(await canRecordBookingActuals())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Enter valid actual hours." }, { status: 400 });
  const context = await getActiveOrganizationContext(); if (!context?.organization || !context.person) return NextResponse.json({ error: "No active person record." }, { status: 401 });
  const { bookingId } = await params; const db = getDb(); const organizationId = context.organization.organizationId; const currency = context.organization.currency;
  const [booking] = await db.select({ id: bookings.id, personId: bookings.personId, episodeId: bookings.episodeId, actualStartsAt: bookings.actualStartsAt }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, organizationId))).limit(1);
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (booking.personId !== context.person.id) return NextResponse.json({ error: "You can only confirm time for your own booking." }, { status: 403 });
  if (booking.actualStartsAt) return NextResponse.json({ error: "Actual time is already confirmed for this booking." }, { status: 409 });
  const projection = booking.episodeId ? await getBookingCostProjection(organizationId, booking.episodeId, { bookingId: booking.id, actualStartsAt: parsed.data.actualStartsAt, actualEndsAt: parsed.data.actualEndsAt, overtimeMinutes: parsed.data.overtimeMinutes }) : null;
  let budgetLine: { id: string; actualAmount: string | number } | null = null;
  if (projection && booking.episodeId) {
    const bookingCode = `BOOKING-${projection.category.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "-")}`;
    const [existing] = await db.select({ id: budgetLines.id, actualAmount: budgetLines.actualAmount }).from(budgetLines)
      .where(and(eq(budgetLines.organizationId, organizationId), eq(budgetLines.episodeId, booking.episodeId), eq(budgetLines.code, bookingCode))).limit(1);
    budgetLine = existing ?? null;
  }
  if (projection && booking.episodeId && !budgetLine) {
    const [episode] = await db.select({ showId: seasons.showId, seasonId: episodes.seasonId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(and(eq(episodes.id, booking.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId))).limit(1);
    if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
    const [created] = await db.insert(budgetLines).values({ organizationId, showId: episode.showId, seasonId: episode.seasonId, episodeId: booking.episodeId, code: `BOOKING-${projection.category.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "-")}`, category: projection.category, description: "Automatically calculated from confirmed room and artist time.", budgetedAmount: String(projection.budgetedAmount), actualAmount: String(projection.actualAmount), currency, costType: "internal" }).returning({ id: budgetLines.id, actualAmount: budgetLines.actualAmount });
    budgetLine = created;
  }

  const recordedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(bookings).set({ actualStartsAt: parsed.data.actualStartsAt, actualEndsAt: parsed.data.actualEndsAt, approvedOvertimeMinutes: parsed.data.overtimeMinutes }).where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, organizationId)));
    if (projection && budgetLine) await tx.update(budgetLines).set({ budgetedAmount: String(projection.budgetedAmount), actualAmount: String(projection.actualAmount), currency, updatedAt: recordedAt }).where(and(eq(budgetLines.id, budgetLine.id), eq(budgetLines.organizationId, organizationId)));
  });
  const isBudgetOverrun = Boolean(projection && projection.actualAmount > projection.budgetedAmount + 0.005);
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: isBudgetOverrun ? "booking.time_overrun_recorded" : "booking.time_confirmed", entityType: "booking", entityId: booking.id, metadata: { episodeId: booking.episodeId, submittedByPersonId: context.person.id, actualStartsAt: parsed.data.actualStartsAt.toISOString(), actualEndsAt: parsed.data.actualEndsAt.toISOString(), overtimeMinutes: parsed.data.overtimeMinutes, note: parsed.data.note ?? null, bookingCost: projection } });
  return NextResponse.json({ confirmed: true, budgetOverrun: isBudgetOverrun, budgetLineId: budgetLine?.id ?? null }, { status: 201 });
}
