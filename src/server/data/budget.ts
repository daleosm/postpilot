import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { billables, budgetLines, episodes, seasons, serviceRates, shows } from "@/lib/db/schema";

export async function getBudgetData(organizationId: string) {
  const db = getDb();
  const [lines, invoices] = await Promise.all([
    db.select({
      id: budgetLines.id,
      category: budgetLines.category,
      description: budgetLines.description,
      budgetedAmount: budgetLines.budgetedAmount,
      actualAmount: budgetLines.actualAmount,
      currency: budgetLines.currency,
      costType: budgetLines.costType,
      showId: shows.id,
      showTitle: shows.title,
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      episodeNumber: episodes.number,
    })
      .from(budgetLines)
      .leftJoin(episodes, eq(budgetLines.episodeId, episodes.id))
      .leftJoin(seasons, eq(episodes.seasonId, seasons.id))
      .leftJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(budgetLines.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))),
    db.select().from(billables).where(eq(billables.organizationId, organizationId)).orderBy(desc(billables.invoiceDate)),
  ]);
  return {
    lines,
    billables: invoices,
    totals: lines.reduce((total, line) => ({ budgeted: total.budgeted + Number(line.budgetedAmount), actual: total.actual + Number(line.actualAmount) }), { budgeted: 0, actual: 0 }),
  };
}

export async function listServiceRates(organizationId: string) {
  const db = getDb();
  return db.select({ id: serviceRates.id, name: serviceRates.name, category: serviceRates.category, unit: serviceRates.unit, rate: serviceRates.rate, currency: serviceRates.currency, notes: serviceRates.notes, isActive: serviceRates.isActive })
    .from(serviceRates).where(eq(serviceRates.organizationId, organizationId)).orderBy(desc(serviceRates.isActive), serviceRates.name);
}
