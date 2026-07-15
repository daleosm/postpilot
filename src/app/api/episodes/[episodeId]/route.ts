import { and, eq, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { activityLog, episodeWorkflowApprovals, episodes, people, postWorkOrders, postWorkflows, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { can } from "@/lib/permissions";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { createStageWorkOrders } from "@/lib/work-orders";
import { resolveEpisodeWorkflowSigners } from "@/lib/workflow-signoffs";

const stageUpdateSchema = z.object({ workflowStageId: z.string().min(1) });
const approvalActionSchema = z.object({ workflowStageId: z.string().min(1), action: z.literal("sign_off"), comment: z.string().trim().max(2000).optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = stageUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a workflow stage." }, { status: 400 });
  const { episodeId } = await params;

  if (isDebugDemoMode) return NextResponse.json({ error: "Workflow configuration requires the database-backed debug environment." }, { status: 503 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [[episode], [stage]] = await Promise.all([
    db.select({ id: episodes.id, workflowStageId: episodes.workflowStageId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1),
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key, position: workflowStages.position, canStartEarly: workflowStages.canStartEarly }).from(workflowStages).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id)).where(and(eq(workflowStages.id, parsed.data.workflowStageId), eq(workflowStages.organizationId, organizationId), eq(postWorkflows.organizationId, organizationId))).limit(1),
  ]);
  if (!episode || !stage) return NextResponse.json({ error: "Episode or workflow stage not found." }, { status: 404 });
  const targetRules = await db.select({ id: workflowStageApprovalRules.id, approverRole: workflowStageApprovalRules.approverRole })
    .from(workflowStageApprovalRules)
    .where(and(eq(workflowStageApprovalRules.organizationId, organizationId), eq(workflowStageApprovalRules.workflowStageId, stage.id)));
  const targetSigners = await resolveEpisodeWorkflowSigners(organizationId, episode.id, targetRules);
  const unresolvedRule = targetSigners.find((route) => !route.signer);
  if (unresolvedRule) return NextResponse.json({ error: `Choose the episode workflow signer for ${unresolvedRule.approverRole.replaceAll("_", " ")} before moving to this stage.` }, { status: 409 });
  if (episode.workflowStageId && episode.workflowStageId !== stage.id) {
    if (!stage.canStartEarly) {
      const [currentStage] = await db.select({ id: workflowStages.id, position: workflowStages.position }).from(workflowStages).where(and(eq(workflowStages.id, episode.workflowStageId), eq(workflowStages.organizationId, organizationId))).limit(1);
      if (!currentStage || stage.position !== currentStage.position + 1) return NextResponse.json({ error: "Workflow stages normally proceed in order. Enable Allow early start in workflow settings to make an exception." }, { status: 409 });
      const [rules, approvals] = await Promise.all([
        db.select({ id: workflowStageApprovalRules.id }).from(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.organizationId, organizationId), eq(workflowStageApprovalRules.workflowStageId, episode.workflowStageId))),
        db.select({ approvalRuleId: episodeWorkflowApprovals.approvalRuleId, status: episodeWorkflowApprovals.status }).from(episodeWorkflowApprovals).where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), eq(episodeWorkflowApprovals.episodeId, episode.id), eq(episodeWorkflowApprovals.workflowStageId, episode.workflowStageId))),
      ]);
      if (!rules.length || !rules.every((rule) => approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return NextResponse.json({ error: "Complete every configured sign-off for the current stage before advancing." }, { status: 409 });
    }
  }
  await db.update(episodes).set({ workflowStageId: stage.id, updatedAt: new Date() }).where(and(eq(episodes.id, episode.id), eq(episodes.organizationId, organizationId)));
  if (targetSigners.length) await db.insert(episodeWorkflowApprovals).values(targetSigners.map((route) => ({ organizationId, episodeId: episode.id, workflowStageId: stage.id, approvalRuleId: route.ruleId, approverRole: route.approverRole, requiredPersonId: route.signer!.personId, status: "pending" as const }))).onConflictDoNothing();
  await createStageWorkOrders({ organizationId, episodeId: episode.id, workflowStageId: stage.id, createdByUserId: context.userId });
  return NextResponse.json({ ok: true, workflowStage: stage });
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const parsed = approvalActionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid workflow sign-off action." }, { status: 400 });
  const { episodeId } = await params;
  if (isDebugDemoMode) return NextResponse.json({ error: "Workflow configuration requires the database-backed debug environment." }, { status: 503 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [[episode], [stage], [person]] = await Promise.all([
    db.select({ id: episodes.id, workflowStageId: episodes.workflowStageId, qcStatus: episodes.qcStatus }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key }).from(workflowStages).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id)).where(and(eq(workflowStages.id, parsed.data.workflowStageId), eq(workflowStages.organizationId, context.organization.organizationId), eq(postWorkflows.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1),
  ]);
  if (!episode || !stage) return NextResponse.json({ error: "Episode or workflow stage not found." }, { status: 404 });
  if (episode.workflowStageId !== stage.id) return NextResponse.json({ error: "Only the current workflow stage can be signed off." }, { status: 409 });

  const blockers = await db.select({ id: postWorkOrders.id }).from(postWorkOrders).where(and(
    eq(postWorkOrders.organizationId, organizationId),
    eq(postWorkOrders.episodeId, episodeId),
    eq(postWorkOrders.workflowStageId, stage.id),
    eq(postWorkOrders.isBlocking, true),
    notInArray(postWorkOrders.status, ["complete", "cancelled"]),
  )).limit(1);
  if (blockers.length) return NextResponse.json({ error: "Complete every blocking work order for this stage before sign-off." }, { status: 409 });

  if (!person) return NextResponse.json({ error: "Your account is not set up as a named workflow approver." }, { status: 403 });
  const [rules, approvals] = await Promise.all([
    db.select({ id: workflowStageApprovalRules.id, approverRole: workflowStageApprovalRules.approverRole, approvalOrder: workflowStageApprovalRules.approvalOrder, isRequired: workflowStageApprovalRules.isRequired })
      .from(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.organizationId, organizationId), eq(workflowStageApprovalRules.workflowStageId, stage.id))).orderBy(workflowStageApprovalRules.approvalOrder),
    db.select({ id: episodeWorkflowApprovals.id, approvalRuleId: episodeWorkflowApprovals.approvalRuleId, requiredPersonId: episodeWorkflowApprovals.requiredPersonId, status: episodeWorkflowApprovals.status })
      .from(episodeWorkflowApprovals).where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), eq(episodeWorkflowApprovals.episodeId, episodeId), eq(episodeWorkflowApprovals.workflowStageId, stage.id))),
  ]);
  if (!rules.length) return NextResponse.json({ error: "This workflow stage has no configured sign-offs." }, { status: 409 });
  const candidate = rules.find((rule) => !approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"));
  if (!candidate) return NextResponse.json({ error: "Every configured sign-off has already been recorded for this stage." }, { status: 409 });
  if (rules.some((rule) => rule.approvalOrder < candidate.approvalOrder && !approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return NextResponse.json({ error: "Complete the earlier sign-offs first." }, { status: 409 });
  const existingApproval = approvals.find((approval) => approval.approvalRuleId === candidate.id);
  const fallbackSigner = existingApproval?.requiredPersonId ? null : (await resolveEpisodeWorkflowSigners(organizationId, episodeId, [candidate]))[0]?.signer;
  const requiredPersonId = existingApproval?.requiredPersonId ?? fallbackSigner?.personId ?? null;
  if (!requiredPersonId) return NextResponse.json({ error: "Choose the episode workflow signer before this stage can be signed off." }, { status: 409 });
  if (requiredPersonId !== person.id) return NextResponse.json({ error: "This sign-off is assigned to another episode-team member." }, { status: 403 });
  if (existingApproval) {
    await db.update(episodeWorkflowApprovals).set({ status: "approved", requiredPersonId: person.id, approverPersonId: person.id, comment: parsed.data.comment || null, respondedAt: new Date(), updatedAt: new Date() }).where(and(eq(episodeWorkflowApprovals.id, existingApproval.id), eq(episodeWorkflowApprovals.organizationId, organizationId)));
  } else {
    await db.insert(episodeWorkflowApprovals).values({ organizationId, episodeId, workflowStageId: stage.id, approvalRuleId: candidate.id, approverRole: candidate.approverRole, requiredPersonId, approverPersonId: person.id, status: "approved", comment: parsed.data.comment || null, respondedAt: new Date() });
  }
  const stageWillBeApproved = rules.every((rule) => rule.id === candidate.id || approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"));
  await db.insert(activityLog).values({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "workflow.signed_off", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, approverRole: candidate.approverRole } });
  return NextResponse.json({ ok: true, status: "approved", approvalRuleId: candidate.id, stageComplete: stageWillBeApproved });
}
