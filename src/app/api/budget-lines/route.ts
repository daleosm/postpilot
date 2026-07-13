import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { budgetLines, episodes, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { checkPurchaseOrderAllocation, reconcilePurchaseOrder } from "@/lib/purchase-orders";
import { createEpisodeBudgetLineSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createEpisodeBudgetLineSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the budget line." }, { status: 400 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const [episode] = await db.select({ showId: shows.id, seasonId: seasons.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId)))
    .limit(1);
  if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  try {
    await checkPurchaseOrderAllocation(context.organization.organizationId, parsed.data.purchaseOrderId, parsed.data.actualAmount, "vendor_commitment", await can("approve_po_overruns"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to allocate this PO." }, { status: 409 });
  }

  const [line] = await db.insert(budgetLines).values({
    ...parsed.data,
    organizationId: context.organization.organizationId,
    showId: episode.showId,
    seasonId: episode.seasonId,
    budgetedAmount: String(parsed.data.budgetedAmount),
    actualAmount: String(parsed.data.actualAmount),
  }).returning({ id: budgetLines.id });
  if (parsed.data.purchaseOrderId) await reconcilePurchaseOrder(context.organization.organizationId, parsed.data.purchaseOrderId, { actorUserId: context.userId, action: "allocation.internal_cost", amount: parsed.data.actualAmount, metadata: { budgetLineId: line.id, episodeId: parsed.data.episodeId } });
  return NextResponse.json(line, { status: 201 });
}
