import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { budgetLines, episodes, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { updateBudgetLineSchema } from "@/lib/validations/entities";

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
  const { lineId } = await params;
  const result = await getMutableLine(lineId, organizationId);
  if ("error" in result) return result.error;
  const { episodeId, showId, seasonId, budgetedAmount, actualAmount, ...rest } = parsed.data;
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
  await getDb().update(budgetLines).set({
    ...rest,
    ...(episodeId !== undefined ? { episodeId, showId: episodeScope!.showId, seasonId: episodeScope!.seasonId } : {}),
    ...(budgetedAmount === undefined ? {} : { budgetedAmount: String(budgetedAmount) }),
    ...(actualAmount === undefined ? {} : { actualAmount: String(actualAmount) }),
    currency: context.organization.currency,
    updatedAt: new Date(),
  }).where(and(eq(budgetLines.id, lineId), eq(budgetLines.organizationId, organizationId)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "budget_line.updated", entityType: "budget_line", entityId: lineId, metadata: { episodeId: episodeId ?? result.line.episodeId } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { lineId } = await params;
  const result = await getMutableLine(lineId, context.organization.organizationId);
  if ("error" in result) return result.error;
  await getDb().delete(budgetLines).where(and(eq(budgetLines.id, lineId), eq(budgetLines.organizationId, context.organization.organizationId)));
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "budget_line.deleted", entityType: "budget_line", entityId: lineId, metadata: { episodeId: result.line.episodeId } });
  return NextResponse.json({ ok: true });
}
