import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { billables, bookings, budgetLines, cateringRequests, cateringSettings, episodes, people, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { updateCateringRequestSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  if (!(await can("manage_catering"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateCateringRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid fulfilment status." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { requestId } = await params;
  const db = getDb();
  const [[cateringRequest], [runner]] = await Promise.all([
    db.select({ id: cateringRequests.id, bookingId: cateringRequests.bookingId, billableId: cateringRequests.billableId, budgetLineId: cateringRequests.budgetLineId }).from(cateringRequests).where(and(eq(cateringRequests.id, requestId), eq(cateringRequests.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1),
  ]);
  if (!cateringRequest) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (parsed.data.actualCost !== undefined && parsed.data.actualCost !== null && !cateringRequest.bookingId) return NextResponse.json({ error: "Link this request to an episode booking before recording a billable cost." }, { status: 400 });
  let billableId = cateringRequest.billableId; let budgetLineId = cateringRequest.budgetLineId;
  if (parsed.data.actualCost !== undefined && parsed.data.actualCost !== null) {
    const [booking] = await db.select({ episodeId: bookings.episodeId, seasonId: episodes.seasonId, showId: shows.id }).from(bookings).leftJoin(episodes, eq(bookings.episodeId, episodes.id)).leftJoin(seasons, eq(episodes.seasonId, seasons.id)).leftJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(bookings.id, cateringRequest.bookingId!), eq(bookings.organizationId, context.organization.organizationId))).limit(1);
    if (!booking?.episodeId || !booking.seasonId || !booking.showId) return NextResponse.json({ error: "This booking is not linked to an episode, so its catering cannot be billed." }, { status: 400 });
    const amount = String(parsed.data.actualCost); const currency = parsed.data.currency ?? "GBP";
    const [settings] = await db.select({ markupPercent: cateringSettings.markupPercent }).from(cateringSettings).where(eq(cateringSettings.organizationId, context.organization.organizationId)).limit(1);
    const markupPercent = Number(settings?.markupPercent ?? 0); const billedAmount = (Number(parsed.data.actualCost) * (1 + markupPercent / 100)).toFixed(2);
    if (billableId) await db.update(billables).set({ amount: billedAmount, currency, description: `Catering — ${requestId}`, updatedAt: new Date() }).where(and(eq(billables.id, billableId), eq(billables.organizationId, context.organization.organizationId)));
    else { const [billable] = await db.insert(billables).values({ organizationId: context.organization.organizationId, showId: booking.showId, episodeId: booking.episodeId, vendor: "Catering", reference: parsed.data.receiptReference ?? null, description: `Catering — ${requestId}`, amount: billedAmount, currency, status: "draft" }).returning({ id: billables.id }); billableId = billable.id; }
    if (budgetLineId) await db.update(budgetLines).set({ actualAmount: amount, currency, updatedAt: new Date() }).where(and(eq(budgetLines.id, budgetLineId), eq(budgetLines.organizationId, context.organization.organizationId)));
    else { const [budgetLine] = await db.insert(budgetLines).values({ organizationId: context.organization.organizationId, showId: booking.showId, seasonId: booking.seasonId, episodeId: booking.episodeId, code: `CATERING-${requestId.slice(0, 8)}`, category: "Catering", description: "Runner fulfilled catering request", budgetedAmount: "0", actualAmount: amount, currency, costType: "billable" }).returning({ id: budgetLines.id }); budgetLineId = budgetLine.id; }
  }
  const [currentSettings] = await db.select({ markupPercent: cateringSettings.markupPercent }).from(cateringSettings).where(eq(cateringSettings.organizationId, context.organization.organizationId)).limit(1);
  const markupPercent = Number(currentSettings?.markupPercent ?? 0); const billedAmount = parsed.data.actualCost === undefined || parsed.data.actualCost === null ? undefined : (Number(parsed.data.actualCost) * (1 + markupPercent / 100)).toFixed(2);
  await db.update(cateringRequests).set({ status: parsed.data.status, fulfilledByPersonId: runner?.id ?? null, fulfilledAt: parsed.data.status === "delivered" ? new Date() : null, actualCost: parsed.data.actualCost === undefined ? undefined : parsed.data.actualCost === null ? null : String(parsed.data.actualCost), billedAmount, markupPercent: parsed.data.actualCost === undefined ? undefined : String(markupPercent), currency: parsed.data.currency, receiptReference: parsed.data.receiptReference === undefined ? undefined : parsed.data.receiptReference, billableId, budgetLineId, updatedAt: new Date() }).where(and(eq(cateringRequests.id, requestId), eq(cateringRequests.organizationId, context.organization.organizationId)));
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: parsed.data.actualCost !== undefined && parsed.data.actualCost !== null ? "catering.cost_recorded" : `catering.${parsed.data.status}`, entityType: "catering_request", entityId: requestId, metadata: parsed.data.actualCost !== undefined ? { actualCost: parsed.data.actualCost, billableId } : undefined });
  return NextResponse.json({ ok: true, status: parsed.data.status });
}
