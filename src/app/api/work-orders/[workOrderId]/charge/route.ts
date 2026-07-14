import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { billables, budgetLines, episodes, postWorkOrders, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
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
    estimatedAmount: postWorkOrders.estimatedAmount, clientQuoteAmount: postWorkOrders.clientQuoteAmount, currency: postWorkOrders.currency, clientQuoteCurrency: postWorkOrders.clientQuoteCurrency, showId: shows.id, seasonId: seasons.id,
  }).from(postWorkOrders)
    .innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId)))
    .limit(1);
  if (!workOrder) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  if (workOrder.billingScope !== "billable_change") return NextResponse.json({ error: "Only a client-billable change can be posted to the budget." }, { status: 409 });
  if (workOrder.status !== "complete" || workOrder.billingStatus !== "awaiting_finance") return NextResponse.json({ error: "Complete the work order before its approved charge can be posted." }, { status: 409 });
  const [line] = await db.insert(budgetLines).values({
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
  const [billable] = await db.insert(billables).values({ organizationId, showId: workOrder.showId, episodeId: workOrder.episodeId, vendor: "Client change", reference: parsed.data.reference ?? null, description: workOrder.title, amount: String(parsed.data.actualAmount), currency: workOrder.clientQuoteCurrency ?? workOrder.currency, status: "approved" }).returning({ id: billables.id });
  await db.update(postWorkOrders).set({ actualAmount: String(parsed.data.actualAmount), billingStatus: "posted", updatedAt: new Date() })
    .where(and(eq(postWorkOrders.id, workOrder.id), eq(postWorkOrders.organizationId, organizationId)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "work_order.charge_posted", entityType: "post_work_order", entityId: workOrder.id, metadata: { episodeId: workOrder.episodeId, budgetLineId: line.id, billableId: billable.id, actualAmount: parsed.data.actualAmount } });
  return NextResponse.json(line, { status: 201 });
}
