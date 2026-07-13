import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { billables, budgetLines, episodes, postWorkOrders, seasons, serviceRates, shows } from "@/lib/db/schema";

export async function getBudgetData(organizationId: string) {
  const db = getDb();
  const [lines, invoices, workOrderCharges] = await Promise.all([
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
    db.select({
      id: postWorkOrders.id, title: postWorkOrders.title, department: postWorkOrders.department, status: postWorkOrders.status,
      billingStatus: postWorkOrders.billingStatus, estimatedAmount: postWorkOrders.estimatedAmount, actualAmount: postWorkOrders.actualAmount,
      currency: postWorkOrders.currency, billingNotes: postWorkOrders.billingNotes, episodeId: episodes.id, episodeTitle: episodes.title,
      episodeNumber: episodes.number, showTitle: shows.title,
    }).from(postWorkOrders)
      .innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.billingScope, "billable_change"), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId)))
      .orderBy(asc(postWorkOrders.createdAt)),
  ]);
  return {
    lines,
    billables: invoices,
    workOrderCharges,
    totals: lines.reduce((total, line) => ({ budgeted: total.budgeted + Number(line.budgetedAmount), actual: total.actual + Number(line.actualAmount) }), { budgeted: 0, actual: 0 }),
  };
}

export async function listServiceRates(organizationId: string) {
  const db = getDb();
  return db.select({ id: serviceRates.id, name: serviceRates.name, category: serviceRates.category, unit: serviceRates.unit, rate: serviceRates.rate, currency: serviceRates.currency, notes: serviceRates.notes, isActive: serviceRates.isActive })
    .from(serviceRates).where(eq(serviceRates.organizationId, organizationId)).orderBy(desc(serviceRates.isActive), serviceRates.name);
}
