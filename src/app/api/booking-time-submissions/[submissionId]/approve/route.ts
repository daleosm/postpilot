import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { bookingTimeSubmissions, bookings, budgetLines, episodes, seasons } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { getBookingCostApprovalProjection } from "@/server/data";

export async function POST(_: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  if (!(await can("approve_time"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext(); if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const organizationId = context.organization.organizationId;
  const { submissionId } = await params; const db = getDb();
  const [submission] = await db.select().from(bookingTimeSubmissions).where(and(eq(bookingTimeSubmissions.id, submissionId), eq(bookingTimeSubmissions.organizationId, organizationId), eq(bookingTimeSubmissions.status, "pending"))).limit(1);
  if (!submission) return NextResponse.json({ error: "Pending time submission not found." }, { status: 404 });
  const [booking] = await db.select({ id: bookings.id, episodeId: bookings.episodeId }).from(bookings).where(and(eq(bookings.id, submission.bookingId), eq(bookings.organizationId, organizationId))).limit(1);
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

  const projection = booking.episodeId ? await getBookingCostApprovalProjection(organizationId, booking.episodeId, { bookingId: booking.id, actualStartsAt: submission.actualStartsAt, actualEndsAt: submission.actualEndsAt, overtimeMinutes: submission.overtimeMinutes }) : null;
  const mayApproveBudgetOverrun = await can("approve_budget_overruns");
  const isBudgetOverrun = Boolean(projection && projection.actualAmount > projection.budgetedAmount + 0.005);
  if (isBudgetOverrun && !mayApproveBudgetOverrun) return NextResponse.json({ error: `This approved time would put ${projection!.category} ${projection!.currency ?? ""} ${(projection!.actualAmount - projection!.budgetedAmount).toFixed(2)} over its booking estimate. A user with Approve budget overruns must approve it.`, code: "BUDGET_OVERRUN" }, { status: 409 });

  let budgetLine: { id: string; actualAmount: string | number } | null = null;
  if (projection && booking.episodeId) {
    const [existing] = await db.select({ id: budgetLines.id, actualAmount: budgetLines.actualAmount }).from(budgetLines)
      .where(and(eq(budgetLines.organizationId, organizationId), eq(budgetLines.episodeId, booking.episodeId), eq(budgetLines.category, projection.category))).limit(1);
    budgetLine = existing ?? null;
  }

  if (projection && booking.episodeId && !budgetLine) {
    const [episode] = await db.select({ showId: seasons.showId, seasonId: episodes.seasonId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(and(eq(episodes.id, booking.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId))).limit(1);
    if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
    const [created] = await db.insert(budgetLines).values({ organizationId, showId: episode.showId, seasonId: episode.seasonId, episodeId: booking.episodeId, code: `BOOKING-${projection.category.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "-")}`, category: projection.category, description: "Automatically calculated from approved room and artist time.", budgetedAmount: String(projection.budgetedAmount), actualAmount: String(projection.actualAmount), currency: projection.currency ?? "USD", costType: "internal" }).returning({ id: budgetLines.id, actualAmount: budgetLines.actualAmount });
    budgetLine = created;
  }

  await db.transaction(async (tx) => {
    await tx.update(bookingTimeSubmissions).set({ status: "approved", reviewedByPersonId: context.person?.id ?? null, reviewedAt: new Date() }).where(eq(bookingTimeSubmissions.id, submission.id));
    await tx.update(bookings).set({ actualStartsAt: submission.actualStartsAt, actualEndsAt: submission.actualEndsAt, approvedOvertimeMinutes: submission.overtimeMinutes }).where(and(eq(bookings.id, submission.bookingId), eq(bookings.organizationId, organizationId)));
    if (projection && budgetLine) await tx.update(budgetLines).set({ budgetedAmount: String(projection.budgetedAmount), actualAmount: String(projection.actualAmount), currency: projection.currency ?? "USD", updatedAt: new Date() }).where(and(eq(budgetLines.id, budgetLine.id), eq(budgetLines.organizationId, organizationId)));
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: isBudgetOverrun ? "booking.time_overrun_approved" : "booking.time_approved", entityType: "booking", entityId: booking.id, metadata: { episodeId: booking.episodeId, bookingCost: projection } });
  return NextResponse.json({ approved: true, budgetOverrun: isBudgetOverrun, budgetLineId: budgetLine?.id ?? null });
}
