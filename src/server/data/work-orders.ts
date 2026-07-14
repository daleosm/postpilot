import "server-only";

import { aliasedTable, and, asc, eq, notInArray, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { budgetLines, episodes, people, postWorkOrders, seasons, shows, workflowStages } from "@/lib/db/schema";

const assignees = aliasedTable(people, "work_order_assignees");
const workOrderBudgetLines = aliasedTable(budgetLines, "work_order_budget_lines");

export async function listEpisodeWorkOrders(organizationId: string, episodeId: string) {
  const db = getDb();
  return db.select({
    id: postWorkOrders.id, episodeId: postWorkOrders.episodeId, workflowStageId: postWorkOrders.workflowStageId, workflowStageName: workflowStages.name,
    kind: postWorkOrders.kind, title: postWorkOrders.title, description: postWorkOrders.description, department: postWorkOrders.department,
    assigneePersonId: postWorkOrders.assigneePersonId, assigneeName: assignees.name, assigneeRole: postWorkOrders.assigneeRole, vendorCompanyId: postWorkOrders.vendorCompanyId,
    priority: postWorkOrders.priority, isBlocking: postWorkOrders.isBlocking, status: postWorkOrders.status, externalUrl: postWorkOrders.externalUrl,
    billingScope: postWorkOrders.billingScope, billingStatus: postWorkOrders.billingStatus, estimatedAmount: postWorkOrders.estimatedAmount, clientQuoteAmount: postWorkOrders.clientQuoteAmount, actualAmount: postWorkOrders.actualAmount, currency: postWorkOrders.currency, clientQuoteCurrency: postWorkOrders.clientQuoteCurrency, billingNotes: postWorkOrders.billingNotes, budgetLineId: workOrderBudgetLines.id,
    dueAt: postWorkOrders.dueAt, completedAt: postWorkOrders.completedAt, createdAt: postWorkOrders.createdAt,
  }).from(postWorkOrders)
    .leftJoin(workflowStages, and(eq(postWorkOrders.workflowStageId, workflowStages.id), eq(workflowStages.organizationId, organizationId)))
    .leftJoin(assignees, and(eq(postWorkOrders.assigneePersonId, assignees.id), eq(assignees.organizationId, organizationId)))
    .leftJoin(workOrderBudgetLines, and(eq(workOrderBudgetLines.workOrderId, postWorkOrders.id), eq(workOrderBudgetLines.organizationId, organizationId)))
    .where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.episodeId, episodeId)))
    .orderBy(asc(postWorkOrders.status), asc(postWorkOrders.dueAt), asc(postWorkOrders.createdAt));
}

/** Open work explicitly assigned to a person or their tenant role. */
export async function listWorkOrderInbox(organizationId: string, userId: string) {
  const db = getDb();
  const [person] = await db.select({ id: people.id, role: people.role }).from(people)
    .where(and(eq(people.organizationId, organizationId), eq(people.userId, userId))).limit(1);
  if (!person) return [];
  return db.select({
    id: postWorkOrders.id, episodeId: episodes.id, showId: shows.id, showTitle: shows.title, episodeTitle: episodes.title, episodeNumber: episodes.number,
    workflowStageName: workflowStages.name, kind: postWorkOrders.kind, title: postWorkOrders.title, description: postWorkOrders.description,
    priority: postWorkOrders.priority, isBlocking: postWorkOrders.isBlocking, status: postWorkOrders.status, dueAt: postWorkOrders.dueAt, externalUrl: postWorkOrders.externalUrl,
  }).from(postWorkOrders)
    .innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .leftJoin(workflowStages, and(eq(postWorkOrders.workflowStageId, workflowStages.id), eq(workflowStages.organizationId, organizationId)))
    .where(and(
      eq(postWorkOrders.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId),
      notInArray(postWorkOrders.status, ["complete", "cancelled"]),
      or(eq(postWorkOrders.assigneePersonId, person.id), eq(postWorkOrders.assigneeRole, person.role)),
    )).orderBy(asc(postWorkOrders.dueAt), asc(postWorkOrders.priority), asc(postWorkOrders.createdAt));
}
