import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { postWorkflows, workflowStageApprovalRules, workflowStages, workflowStageWorkOrderTemplates } from "@/lib/db/schema";

export async function getDefaultWorkflowConfig(organizationId: string) {
  const db = getDb();
  const [workflow] = await db.select({ id: postWorkflows.id, name: postWorkflows.name, description: postWorkflows.description, showId: postWorkflows.showId, isDefault: postWorkflows.isDefault })
    .from(postWorkflows).where(and(eq(postWorkflows.organizationId, organizationId), eq(postWorkflows.isDefault, true))).limit(1);
  if (!workflow) return null;
  const [stages, rules, workOrderTemplates] = await Promise.all([
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key, position: workflowStages.position, color: workflowStages.color, isTerminal: workflowStages.isTerminal, canStartEarly: workflowStages.canStartEarly })
      .from(workflowStages).where(and(eq(workflowStages.organizationId, organizationId), eq(workflowStages.workflowId, workflow.id))).orderBy(asc(workflowStages.position)),
    db.select({ id: workflowStageApprovalRules.id, workflowStageId: workflowStageApprovalRules.workflowStageId, approverRole: workflowStageApprovalRules.approverRole, label: workflowStageApprovalRules.label, approvalOrder: workflowStageApprovalRules.approvalOrder, isRequired: workflowStageApprovalRules.isRequired })
      .from(workflowStageApprovalRules).innerJoin(workflowStages, eq(workflowStageApprovalRules.workflowStageId, workflowStages.id)).where(and(eq(workflowStageApprovalRules.organizationId, organizationId), eq(workflowStages.organizationId, organizationId), eq(workflowStages.workflowId, workflow.id))).orderBy(asc(workflowStageApprovalRules.approvalOrder)),
    db.select({ id: workflowStageWorkOrderTemplates.id, workflowStageId: workflowStageWorkOrderTemplates.workflowStageId, title: workflowStageWorkOrderTemplates.title, description: workflowStageWorkOrderTemplates.description, department: workflowStageWorkOrderTemplates.department, assigneeRole: workflowStageWorkOrderTemplates.assigneeRole, priority: workflowStageWorkOrderTemplates.priority, isBlocking: workflowStageWorkOrderTemplates.isBlocking, position: workflowStageWorkOrderTemplates.position })
      .from(workflowStageWorkOrderTemplates).innerJoin(workflowStages, eq(workflowStageWorkOrderTemplates.workflowStageId, workflowStages.id)).where(and(eq(workflowStageWorkOrderTemplates.organizationId, organizationId), eq(workflowStages.organizationId, organizationId), eq(workflowStages.workflowId, workflow.id))).orderBy(asc(workflowStageWorkOrderTemplates.position)),
  ]);
  return { ...workflow, stages, rules, workOrderTemplates };
}
