import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { billables, budgetLines, episodes, postWorkOrders, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { checkPurchaseOrderAllocation, reconcilePurchaseOrder } from "@/lib/purchase-orders";
import { postWorkOrderChargeSchema } from "@/lib/validations/entities";

/** A user with the tenant Budget permission explicitly posts a completed client change into the episode budget. This never creates an invoice. */
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
    estimatedAmount: postWorkOrders.estimatedAmount, currency: postWorkOrders.currency, purchaseOrderId: postWorkOrders.purchaseOrderId, showId: shows.id, seasonId: seasons.id,
  }).from(postWorkOrders)
    .innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId)))
    .limit(1);
  if (!workOrder) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  if (workOrder.billingScope !== "billable_change") return NextResponse.json({ error: "Only a client-billable change can be posted to the budget." }, { status: 409 });
  if (workOrder.status !== "complete" || workOrder.billingStatus !== "awaiting_finance") return NextResponse.json({ error: "Complete the work order before its approved charge can be posted." }, { status: 409 });
  const purchaseOrderId = parsed.data.purchaseOrderId ?? workOrder.purchaseOrderId;
  try {
    await checkPurchaseOrderAllocation(organizationId, purchaseOrderId, parsed.data.actualAmount, "client_authorisation", await can("approve_po_overruns"));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to allocate this client PO." }, { status: 409 }); }

  const [line] = await db.insert(budgetLines).values({
    organizationId,
    showId: workOrder.showId,
    seasonId: workOrder.seasonId,
    episodeId: workOrder.episodeId,
    workOrderId: workOrder.id,
    category: parsed.data.category ?? workOrder.department ?? "Post work order",
    description: `${workOrder.title}${parsed.data.reference ? ` · ${parsed.data.reference}` : ""}`,
    budgetedAmount: String(workOrder.estimatedAmount ?? parsed.data.actualAmount),
    actualAmount: String(parsed.data.actualAmount),
    currency: workOrder.currency,
    costType: "billable",
  }).returning({ id: budgetLines.id });
  const [billable] = await db.insert(billables).values({ organizationId, showId: workOrder.showId, episodeId: workOrder.episodeId, purchaseOrderId, vendor: "Client change", reference: parsed.data.reference ?? null, description: workOrder.title, amount: String(parsed.data.actualAmount), currency: workOrder.currency, status: "approved" }).returning({ id: billables.id });
  if (purchaseOrderId) await reconcilePurchaseOrder(organizationId, purchaseOrderId, { actorUserId: context.userId, action: "allocation.client_billable", amount: parsed.data.actualAmount, metadata: { billableId: billable.id, workOrderId: workOrder.id, episodeId: workOrder.episodeId } });
  await db.update(postWorkOrders).set({ actualAmount: String(parsed.data.actualAmount), billingStatus: "posted", updatedAt: new Date() })
    .where(and(eq(postWorkOrders.id, workOrder.id), eq(postWorkOrders.organizationId, organizationId)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "work_order.charge_posted", entityType: "post_work_order", entityId: workOrder.id, metadata: { episodeId: workOrder.episodeId, budgetLineId: line.id, billableId: billable.id, actualAmount: parsed.data.actualAmount } });
  return NextResponse.json(line, { status: 201 });
}
