import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { budgetLines, episodes, purchaseOrderAllocations, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { createEpisodeBudgetLineSchema } from "@/lib/validations/entities";
import { PurchaseOrderError, resolveBudgetLinePurchaseOrder } from "@/server/purchase-orders";

export async function POST(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createEpisodeBudgetLineSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the budget line." }, { status: 400 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const currency = context.organization.currency;

  const db = getDb();
  const [episode] = await db.select({ showId: shows.id, seasonId: seasons.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId)))
    .limit(1);
  if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  let purchaseOrder;
  try {
    purchaseOrder = await resolveBudgetLinePurchaseOrder(organizationId, {
      purchaseOrderId: parsed.data.purchaseOrderId,
      externalCost: parsed.data.externalCost,
      showId: episode.showId,
      episodeId: parsed.data.episodeId,
    });
  } catch (error) {
    if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const line = await db.transaction(async (tx) => {
    const [created] = await tx.insert(budgetLines).values({
      ...parsed.data,
      organizationId,
      showId: episode.showId,
      seasonId: episode.seasonId,
      purchaseOrderId: purchaseOrder?.id ?? null,
      budgetedAmount: String(parsed.data.budgetedAmount),
      actualAmount: String(parsed.data.actualAmount),
      currency,
    }).returning({ id: budgetLines.id });
    if (purchaseOrder) await tx.insert(purchaseOrderAllocations).values({
      organizationId,
      purchaseOrderId: purchaseOrder.id,
      allocationType: "budget_line",
      budgetLineId: created.id,
      amount: String(parsed.data.budgetedAmount),
      allocationDate: new Date().toISOString().slice(0, 10),
      reference: `Budget line ${created.id.slice(0, 8)}`,
      description: parsed.data.description ?? parsed.data.category,
      createdByUserId: context.userId,
    });
    return created;
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "budget_line.created", entityType: "budget_line", entityId: line.id, metadata: { episodeId: parsed.data.episodeId, category: parsed.data.category } });
  return NextResponse.json(line, { status: 201 });
}
