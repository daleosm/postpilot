import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { billables, budgetLines, clientPurchaseOrderAllocations, episodes, postWorkOrders, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postWorkOrderChargeSchema } from "@/lib/validations/entities";
import { ClientPurchaseOrderError, selectApplicableClientPurchaseOrder } from "@/server/client-purchase-orders";

/** A Budget user explicitly posts a completed client change into the episode budget. This never creates an invoice. */
export async function POST(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = postWorkOrderChargeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the charge details." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { workOrderId } = await params;
  const db = getDb();
  const [workOrder] = await db.select({
    id: postWorkOrders.id, episodeId: postWorkOrders.episodeId, title: postWorkOrders.title, department: postWorkOrders.department,
    status: postWorkOrders.status, billingScope: postWorkOrders.billingScope, billingStatus: postWorkOrders.billingStatus,
    estimatedAmount: postWorkOrders.estimatedAmount, clientQuoteAmount: postWorkOrders.clientQuoteAmount, currency: postWorkOrders.currency, clientQuoteCurrency: postWorkOrders.clientQuoteCurrency, showId: shows.id, seasonId: seasons.id, clientCompanyId: shows.clientCompanyId, clientPurchaseOrderId: postWorkOrders.clientPurchaseOrderId,
  }).from(postWorkOrders)
    .innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId)))
    .limit(1);
  if (!workOrder) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  if (workOrder.billingScope !== "billable_change") return NextResponse.json({ error: "Only a client-billable change can be posted to the budget." }, { status: 409 });
  if (workOrder.status !== "complete" || workOrder.billingStatus !== "draft") return NextResponse.json({ error: "Complete the work order before its charge can be posted." }, { status: 409 });
  let clientPurchaseOrder: Awaited<ReturnType<typeof selectApplicableClientPurchaseOrder>> | null = null;
  const selectedClientPurchaseOrderId = workOrder.clientPurchaseOrderId ?? parsed.data.clientPurchaseOrderId;
  if (selectedClientPurchaseOrderId) {
    try {
      clientPurchaseOrder = await selectApplicableClientPurchaseOrder(organizationId, { clientPurchaseOrderId: selectedClientPurchaseOrderId, clientCompanyId: workOrder.clientCompanyId, showId: workOrder.showId, episodeId: workOrder.episodeId });
    } catch (error) {
      if (error instanceof ClientPurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
    const overrun = Number(parsed.data.actualAmount) - clientPurchaseOrder.remainingAmount;
    if (overrun > 0) {
      if (!parsed.data.clientPoOverrunReason) return NextResponse.json({ error: `This charge exceeds remaining ${clientPurchaseOrder.currency} PO value by ${overrun.toFixed(2)}. Explain the overrun before authorising it.` }, { status: 400 });
      if (!(await can("approve_budget_overruns"))) return NextResponse.json({ error: "Your role needs the Budget approval permission to authorise this PO overrun." }, { status: 403 });
    }
  }
  const clientPoOverrunAuthorised = Boolean(clientPurchaseOrder && Number(parsed.data.actualAmount) > clientPurchaseOrder.remainingAmount);
  const { line, billable } = await db.transaction(async (tx) => {
    const [line] = await tx.insert(budgetLines).values({
      organizationId,
      showId: workOrder.showId,
      seasonId: workOrder.seasonId,
      episodeId: workOrder.episodeId,
      workOrderId: workOrder.id,
      category: parsed.data.category ?? workOrder.department ?? "Post work order",
      description: `${workOrder.title}${parsed.data.reference ? ` · ${parsed.data.reference}` : ""}`,
      budgetedAmount: String(workOrder.clientQuoteAmount ?? workOrder.estimatedAmount ?? parsed.data.actualAmount),
      actualAmount: String(parsed.data.actualAmount),
      currency: workOrder.clientQuoteCurrency ?? workOrder.currency,
      costType: "billable",
    }).returning({ id: budgetLines.id });
    const [billable] = await tx.insert(billables).values({ organizationId, showId: workOrder.showId, episodeId: workOrder.episodeId, clientPurchaseOrderId: clientPurchaseOrder?.id ?? null, vendor: "Client change", reference: parsed.data.reference ?? null, description: workOrder.title, amount: String(parsed.data.actualAmount), currency: workOrder.clientQuoteCurrency ?? workOrder.currency, status: "approved" }).returning({ id: billables.id });
    if (clientPurchaseOrder) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`postpilot-client-po:${clientPurchaseOrder.id}`}))`);
      await tx.insert(clientPurchaseOrderAllocations).values({ organizationId, clientPurchaseOrderId: clientPurchaseOrder.id, allocationType: "billable", billableId: billable.id, amount: String(parsed.data.actualAmount), overrunAuthorised: clientPoOverrunAuthorised, allocationDate: new Date().toISOString().slice(0, 10), reference: parsed.data.reference ?? null, description: workOrder.title, createdByUserId: context.userId });
    }
    await tx.update(postWorkOrders).set({ actualAmount: String(parsed.data.actualAmount), billingStatus: "posted", updatedAt: new Date() })
      .where(and(eq(postWorkOrders.id, workOrder.id), eq(postWorkOrders.organizationId, organizationId)));
    return { line, billable };
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "work_order.charge_posted", entityType: "post_work_order", entityId: workOrder.id, metadata: { episodeId: workOrder.episodeId, budgetLineId: line.id, billableId: billable.id, actualAmount: parsed.data.actualAmount, clientPurchaseOrderId: clientPurchaseOrder?.id ?? null } });
  if (clientPurchaseOrder) await writeAuditEvent({ organizationId, actorUserId: context.userId, action: clientPoOverrunAuthorised ? "client_purchase_order.overrun_authorised" : "client_purchase_order.allocated", entityType: "client_purchase_order", entityId: clientPurchaseOrder.id, metadata: { allocationType: "billable", billableId: billable.id, amount: parsed.data.actualAmount, overrunReason: parsed.data.clientPoOverrunReason ?? null } });
  return NextResponse.json({ ...line, clientPurchaseOrder }, { status: 201 });
}
