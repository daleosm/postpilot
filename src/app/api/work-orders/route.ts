import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { bookings, crmCompanies, episodes, postWorkOrderItems, postWorkOrders, purchaseOrders, seasons, shows, workflowStages } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { createPostWorkOrderSchema } from "@/lib/validations/entities";
import { ClientPurchaseOrderError, selectApplicableClientPurchaseOrder } from "@/server/client-purchase-orders";

export async function POST(request: Request) {
  if (!(await can("manage_work_orders"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const payload = await request.json();
  const parsed = createPostWorkOrderSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the work-order details." }, { status: 400 });
  if (!(await can("manage_budget")) && ["estimatedAmount", "clientQuoteAmount", "billingNotes", "items"].some((field) => field in payload)) return NextResponse.json({ error: "Only users with the Budget permission can set commercial values or line items." }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const currency = context.organization.currency;
  const missing = await missingTenantReferences(organizationId, { episodeId: parsed.data.episodeId, workflowStageId: parsed.data.workflowStageId, bookingId: parsed.data.bookingId, personId: parsed.data.assigneePersonId, companyId: parsed.data.vendorCompanyId });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this post house.` }, { status: 404 });
  const db = getDb();
  const [episode] = await db.select({ id: episodes.id, showId: shows.id, clientCompanyId: shows.clientCompanyId, workflowStageId: episodes.workflowStageId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
  if (!episode) return NextResponse.json({ error: "Episode not found for this post house." }, { status: 404 });
  const [[booking], [targetStage], [currentStage], [vendor], [purchaseOrder]] = await Promise.all([
    parsed.data.bookingId ? db.select({ episodeId: bookings.episodeId }).from(bookings).where(and(eq(bookings.id, parsed.data.bookingId), eq(bookings.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    parsed.data.workflowStageId ? db.select({ workflowId: workflowStages.workflowId }).from(workflowStages).where(and(eq(workflowStages.id, parsed.data.workflowStageId), eq(workflowStages.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    episode.workflowStageId ? db.select({ workflowId: workflowStages.workflowId }).from(workflowStages).where(and(eq(workflowStages.id, episode.workflowStageId), eq(workflowStages.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    parsed.data.vendorCompanyId ? db.select({ type: crmCompanies.type }).from(crmCompanies).where(and(eq(crmCompanies.id, parsed.data.vendorCompanyId), eq(crmCompanies.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    parsed.data.purchaseOrderId ? db.select({ vendorCompanyId: purchaseOrders.vendorCompanyId, showId: purchaseOrders.showId, episodeId: purchaseOrders.episodeId, status: purchaseOrders.status }).from(purchaseOrders).where(and(eq(purchaseOrders.id, parsed.data.purchaseOrderId), eq(purchaseOrders.organizationId, organizationId))).limit(1) : Promise.resolve([]),
  ]);
  if (booking && booking.episodeId !== episode.id) return NextResponse.json({ error: "Booking must belong to this episode." }, { status: 409 });
  if (targetStage && currentStage && targetStage.workflowId !== currentStage.workflowId) return NextResponse.json({ error: "Workflow stage does not belong to this episode's workflow." }, { status: 409 });
  if (parsed.data.workType === "external_vendor" && (!vendor || vendor.type !== "vendor")) return NextResponse.json({ error: "Select a vendor account for external work." }, { status: 400 });
  if (parsed.data.purchaseOrderId && !purchaseOrder) return NextResponse.json({ error: "Purchase order not found for this post house." }, { status: 404 });
  if (purchaseOrder && (parsed.data.workType !== "external_vendor" || purchaseOrder.status !== "approved" || purchaseOrder.vendorCompanyId !== parsed.data.vendorCompanyId || purchaseOrder.showId && purchaseOrder.showId !== episode.showId || purchaseOrder.episodeId && purchaseOrder.episodeId !== episode.id)) return NextResponse.json({ error: "Select an approved PO for this vendor and episode." }, { status: 409 });
  if (parsed.data.clientPurchaseOrderId) {
    try { await selectApplicableClientPurchaseOrder(organizationId, { clientPurchaseOrderId: parsed.data.clientPurchaseOrderId, clientCompanyId: episode.clientCompanyId, showId: episode.showId, episodeId: episode.id }); }
    catch (error) { if (error instanceof ClientPurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  }
  const { estimatedAmount, clientQuoteAmount, items, ...workOrderData } = parsed.data;
  const workOrder = await db.transaction(async (tx) => {
    const [created] = await tx.insert(postWorkOrders).values({
      ...workOrderData,
      vendorCompanyId: parsed.data.workType === "external_vendor" ? parsed.data.vendorCompanyId : null,
      purchaseOrderId: parsed.data.workType === "external_vendor" ? parsed.data.purchaseOrderId : null,
      clientPurchaseOrderId: parsed.data.workType === "internal" && parsed.data.billingScope === "billable_change" ? parsed.data.clientPurchaseOrderId : null,
      estimatedAmount: parsed.data.workType === "external_vendor" && estimatedAmount !== undefined && estimatedAmount !== null ? String(estimatedAmount) : null,
      clientQuoteAmount: clientQuoteAmount === undefined || clientQuoteAmount === null ? clientQuoteAmount : String(clientQuoteAmount),
      organizationId,
      currency,
      clientQuoteCurrency: currency,
      billingStatus: parsed.data.billingScope === "billable_change" ? "draft" : "not_billable",
      status: parsed.data.kind === "qc_exception" ? "in_progress" : "open",
      createdByUserId: context.userId,
    }).returning({ id: postWorkOrders.id });
    if (items.length) await tx.insert(postWorkOrderItems).values(items.map((item, index) => ({ organizationId, workOrderId: created.id, type: item.type, description: item.description, quantity: String(item.quantity), unit: item.unit, unitRate: String(item.unitRate), discountPercent: String(item.discountPercent), notes: item.notes ?? null, position: index + 1 })));
    return created;
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "work_order.created", entityType: "post_work_order", entityId: workOrder.id, metadata: { episodeId: parsed.data.episodeId, kind: parsed.data.kind, priority: parsed.data.priority, billingScope: parsed.data.billingScope, workType: parsed.data.workType, purchaseOrderId: parsed.data.purchaseOrderId ?? null, itemCount: items.length } });
  return NextResponse.json(workOrder, { status: 201 });
}
