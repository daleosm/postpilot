import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { postWorkflows, workflowStageApprovalRules, workflowStages, workflowStageWorkOrderTemplates } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { updateWorkflowTemplateSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateWorkflowTemplateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the workflow configuration." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ ok: true, debug: true });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { workflowId } = await params;
  const db = getDb();
  const [workflow] = await db.select({ id: postWorkflows.id }).from(postWorkflows).where(and(eq(postWorkflows.id, workflowId), eq(postWorkflows.organizationId, organizationId))).limit(1);
  if (!workflow) return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  const existingStages = await db.select({ id: workflowStages.id }).from(workflowStages).where(and(eq(workflowStages.workflowId, workflowId), eq(workflowStages.organizationId, organizationId)));
  const stageIds = new Set(existingStages.map((stage) => stage.id));
  if (parsed.data.stages.some((stage) => !stageIds.has(stage.id)) || parsed.data.rules.some((rule) => !stageIds.has(rule.workflowStageId)) || parsed.data.workOrderTemplates.some((template) => !stageIds.has(template.workflowStageId))) return NextResponse.json({ error: "Workflow contains an invalid stage." }, { status: 400 });
  await db.transaction(async (tx) => {
    await tx.update(postWorkflows).set({ name: parsed.data.name, description: parsed.data.description ?? null, updatedAt: new Date() }).where(and(eq(postWorkflows.id, workflowId), eq(postWorkflows.organizationId, organizationId)));
    // Stage positions are unique per workflow. Move the whole set out of the
    // requested range before applying the new order so a drag-and-drop swap
    // never collides with a still-unmoved row.
    if (existingStages.length) await tx.update(workflowStages).set({ position: sql`${workflowStages.position} + 1000`, updatedAt: new Date() }).where(and(eq(workflowStages.workflowId, workflowId), eq(workflowStages.organizationId, organizationId)));
    for (const stage of parsed.data.stages) await tx.update(workflowStages).set({ name: stage.name, key: stage.key, position: stage.position, color: stage.color, isTerminal: stage.isTerminal, canStartEarly: stage.canStartEarly, updatedAt: new Date() }).where(and(eq(workflowStages.id, stage.id), eq(workflowStages.organizationId, organizationId)));
    if (existingStages.length) await tx.delete(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.organizationId, organizationId), inArray(workflowStageApprovalRules.workflowStageId, existingStages.map((stage) => stage.id))));
    if (parsed.data.rules.length) await tx.insert(workflowStageApprovalRules).values(parsed.data.rules.map((rule) => ({ organizationId, workflowStageId: rule.workflowStageId, approverRole: rule.approverRole, label: rule.label, approvalOrder: rule.approvalOrder, isRequired: true })));
    if (existingStages.length) await tx.delete(workflowStageWorkOrderTemplates).where(and(eq(workflowStageWorkOrderTemplates.organizationId, organizationId), inArray(workflowStageWorkOrderTemplates.workflowStageId, existingStages.map((stage) => stage.id))));
    if (parsed.data.workOrderTemplates.length) await tx.insert(workflowStageWorkOrderTemplates).values(parsed.data.workOrderTemplates.map((template) => ({ organizationId, workflowStageId: template.workflowStageId, title: template.title, description: template.description ?? null, department: template.department ?? null, assigneeRole: template.assigneeRole ?? null, priority: template.priority, isBlocking: template.isBlocking, position: template.position })));
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "workflow.template_updated", entityType: "workflow", entityId: workflowId, metadata: { stageCount: parsed.data.stages.length, ruleCount: parsed.data.rules.length, workOrderTemplateCount: parsed.data.workOrderTemplates.length } });
  return NextResponse.json({ ok: true });
}
