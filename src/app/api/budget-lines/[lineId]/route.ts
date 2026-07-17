import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { budgetLines, episodes, purchaseOrderAllocations, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { updateBudgetLineSchema } from "@/lib/validations/entities";
import { PurchaseOrderError, requirePurchaseOrderOverrunApproval, resolveBudgetLinePurchaseOrder } from "@/server/purchase-orders";
import { getPurchaseOrderDetailForOrganization } from "@/server/data/purchase-orders";

async function getMutableLine(lineId: string, organizationId: string) {
  const [line] = await getDb().select().from(budgetLines)
    .where(and(eq(budgetLines.id, lineId), eq(budgetLines.organizationId, organizationId))).limit(1);
  if (!line) return { error: NextResponse.json({ error: "Budget line not found." }, { status: 404 }) };
  if (line.workOrderId || line.vendorInvoiceId) return { error: NextResponse.json({ error: "This cost line is managed by its linked commercial record." }, { status: 409 }) };
  return { line };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateBudgetLineSchema.safeParse(await request.json());
  if (!parsed.success || !Object.keys(parsed.data).length) return NextResponse.json({ error: "Check the budget line." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const currency = context.organization.currency;
  const { lineId } = await params;
  const result = await getMutableLine(lineId, organizationId);
  if ("error" in result) return result.error;
  const { episodeId, showId, seasonId, budgetedAmount, actualAmount, overrunReason, ...rest } = parsed.data;
  void showId;
  void seasonId;
  let episodeScope: { showId: string; seasonId: string } | null = null;
  if (episodeId !== undefined) {
    if (episodeId === null) return NextResponse.json({ error: "A budget line must remain linked to an episode." }, { status: 400 });
    const [episode] = await getDb().select({ showId: shows.id, seasonId: seasons.id }).from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
    if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
    episodeScope = episode;
  }
  const finalEpisodeId = episodeId === undefined ? result.line.episodeId : episodeId;
  if (!finalEpisodeId) return NextResponse.json({ error: "A budget line must remain linked to an episode." }, { status: 400 });
  const finalScope = episodeScope ?? { showId: result.line.showId!, seasonId: result.line.seasonId! };
  const finalExternalCost = rest.externalCost === undefined ? result.line.externalCost : rest.externalCost;
  const finalPurchaseOrderId = rest.purchaseOrderId === undefined ? result.line.purchaseOrderId : rest.purchaseOrderId;
  let purchaseOrder;
  try {
    purchaseOrder = await resolveBudgetLinePurchaseOrder(organizationId, {
      purchaseOrderId: finalPurchaseOrderId,
      externalCost: finalExternalCost,
      showId: finalScope.showId,
      episodeId: finalEpisodeId,
    });
  } catch (error) {
    if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const finalBudgetedAmount = budgetedAmount === undefined ? String(result.line.budgetedAmount) : String(budgetedAmount);
  const [existingAllocation] = await getDb().select({ id: purchaseOrderAllocations.id, purchaseOrderId: purchaseOrderAllocations.purchaseOrderId, amount: purchaseOrderAllocations.amount })
    .from(purchaseOrderAllocations).where(and(eq(purchaseOrderAllocations.organizationId, organizationId), eq(purchaseOrderAllocations.budgetLineId, lineId))).limit(1);
  if (purchaseOrder) {
    try {
      const detail = await getPurchaseOrderDetailForOrganization(organizationId, purchaseOrder.id);
      if (!detail) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
      await requirePurchaseOrderOverrunApproval({
        organizationId,
        purchaseOrderId: purchaseOrder.id,
        nextCommittedAmount: detail.committedAmount - (existingAllocation?.purchaseOrderId === purchaseOrder.id ? Number(existingAllocation.amount) : 0) + Number(finalBudgetedAmount),
        overrunReason,
      });
    } catch (error) {
      if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  await getDb().transaction(async (tx) => {
    await tx.update(budgetLines).set({
      ...rest,
      purchaseOrderId: purchaseOrder?.id ?? null,
      ...(episodeId !== undefined ? { episodeId, showId: finalScope.showId, seasonId: finalScope.seasonId } : {}),
      ...(budgetedAmount === undefined ? {} : { budgetedAmount: finalBudgetedAmount }),
      ...(actualAmount === undefined ? {} : { actualAmount: String(actualAmount) }),
      currency,
      updatedAt: new Date(),
    }).where(and(eq(budgetLines.id, lineId), eq(budgetLines.organizationId, organizationId)));
    if (!purchaseOrder && existingAllocation) {
      await tx.delete(purchaseOrderAllocations).where(and(eq(purchaseOrderAllocations.id, existingAllocation.id), eq(purchaseOrderAllocations.organizationId, organizationId)));
    } else if (purchaseOrder && existingAllocation) {
      await tx.update(purchaseOrderAllocations).set({ purchaseOrderId: purchaseOrder.id, amount: finalBudgetedAmount, description: rest.description === undefined ? result.line.description ?? result.line.category : rest.description ?? result.line.category, updatedAt: new Date() })
        .where(and(eq(purchaseOrderAllocations.id, existingAllocation.id), eq(purchaseOrderAllocations.organizationId, organizationId)));
    } else if (purchaseOrder) {
      await tx.insert(purchaseOrderAllocations).values({ organizationId, purchaseOrderId: purchaseOrder.id, allocationType: "budget_line", budgetLineId: lineId, amount: finalBudgetedAmount, allocationDate: new Date().toISOString().slice(0, 10), reference: `Budget line ${lineId.slice(0, 8)}`, description: rest.description === undefined ? result.line.description ?? result.line.category : rest.description ?? result.line.category, createdByUserId: context.userId });
    }
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "budget_line.updated", entityType: "budget_line", entityId: lineId, metadata: { episodeId: episodeId ?? result.line.episodeId } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { lineId } = await params;
  const result = await getMutableLine(lineId, organizationId);
  if ("error" in result) return result.error;
  await getDb().transaction(async (tx) => {
    await tx.delete(purchaseOrderAllocations).where(and(eq(purchaseOrderAllocations.organizationId, organizationId), eq(purchaseOrderAllocations.budgetLineId, lineId)));
    await tx.delete(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.organizationId, organizationId)));
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "budget_line.deleted", entityType: "budget_line", entityId: lineId, metadata: { episodeId: result.line.episodeId } });
  return NextResponse.json({ ok: true });
}
