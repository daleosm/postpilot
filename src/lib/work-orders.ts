import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { postWorkOrders, workflowStageWorkOrderTemplates } from "@/lib/db/schema";

/** Creates any tenant-configured checklist items exactly once per episode stage. */
export async function createStageWorkOrders(input: { organizationId: string; episodeId: string; workflowStageId: string; createdByUserId?: string | null }) {
  const db = getDb();
  const templates = await db.select({ title: workflowStageWorkOrderTemplates.title, description: workflowStageWorkOrderTemplates.description, department: workflowStageWorkOrderTemplates.department, assigneeRole: workflowStageWorkOrderTemplates.assigneeRole, priority: workflowStageWorkOrderTemplates.priority, isBlocking: workflowStageWorkOrderTemplates.isBlocking })
    .from(workflowStageWorkOrderTemplates)
    .where(and(eq(workflowStageWorkOrderTemplates.organizationId, input.organizationId), eq(workflowStageWorkOrderTemplates.workflowStageId, input.workflowStageId)));
  if (!templates.length) return [];
  const existing = await db.select({ title: postWorkOrders.title }).from(postWorkOrders)
    .where(and(eq(postWorkOrders.organizationId, input.organizationId), eq(postWorkOrders.episodeId, input.episodeId), eq(postWorkOrders.workflowStageId, input.workflowStageId), inArray(postWorkOrders.title, templates.map((template) => template.title))));
  const titles = new Set(existing.map((item) => item.title));
  const missing = templates.filter((template) => !titles.has(template.title));
  if (!missing.length) return [];
  return db.insert(postWorkOrders).values(missing.map((template) => ({ ...template, organizationId: input.organizationId, episodeId: input.episodeId, workflowStageId: input.workflowStageId, createdByUserId: input.createdByUserId ?? null }))).returning({ id: postWorkOrders.id, title: postWorkOrders.title });
}
