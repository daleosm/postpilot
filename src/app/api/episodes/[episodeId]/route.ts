import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { activityLog, episodeWorkflowApprovals, episodeWorkflowExceptions, episodes, people, postWorkflows, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { can, canSignOffWorkflowTrack, canSubmitWorkflowTrack, canUpdateWorkflowWork, isAssignedToEpisode } from "@/lib/permissions";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { createStageWorkOrders } from "@/lib/work-orders";
import { resolveEpisodeWorkflowSigners } from "@/lib/workflow-signoffs";
import { getOperationalWorkflowBlockers } from "@/lib/workflow-operational-gates";
import { getEpisode } from "@/server/data/episodes";

const workflowActionSchema = z.object({
  workflowStageId: z.string().uuid(),
  action: z.enum(["start", "start_early", "submit", "sign_off", "block", "resume"]),
  approvalRuleId: z.string().uuid().optional(),
  comment: z.string().trim().max(2000).optional(),
  reason: z.string().trim().min(3).max(2000).optional(),
});

async function workflowData(organizationId: string, episodeId: string) {
  const db = getDb();
  const [episodeRows, stages, rules, approvals] = await Promise.all([
    db.select({ id: episodes.id, workflowStageId: episodes.workflowStageId, workflowStatus: episodes.workflowStatus })
      .from(episodes)
      .where(and(eq(episodes.organizationId, organizationId), eq(episodes.id, episodeId)))
      .limit(1),
    db.select({ id: workflowStages.id, name: workflowStages.name, position: workflowStages.position, isTerminal: workflowStages.isTerminal, canStartEarly: workflowStages.canStartEarly, requiresQcPass: workflowStages.requiresQcPass, deliveryGate: workflowStages.deliveryGate })
      .from(workflowStages)
      .innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(eq(workflowStages.organizationId, organizationId), eq(postWorkflows.organizationId, organizationId), eq(postWorkflows.isDefault, true)))
      .orderBy(workflowStages.position),
    db.select({ id: workflowStageApprovalRules.id, workflowStageId: workflowStageApprovalRules.workflowStageId, approverRole: workflowStageApprovalRules.approverRole, approvalOrder: workflowStageApprovalRules.approvalOrder, isRequired: workflowStageApprovalRules.isRequired })
      .from(workflowStageApprovalRules)
      .where(eq(workflowStageApprovalRules.organizationId, organizationId)),
    db.select({ id: episodeWorkflowApprovals.id, workflowStageId: episodeWorkflowApprovals.workflowStageId, approvalRuleId: episodeWorkflowApprovals.approvalRuleId, requiredPersonId: episodeWorkflowApprovals.requiredPersonId, status: episodeWorkflowApprovals.status })
      .from(episodeWorkflowApprovals)
      .where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), eq(episodeWorkflowApprovals.episodeId, episodeId))),
  ]);
  return { episode: episodeRows[0] ?? null, stages, rules, approvals };
}

type WorkflowData = Awaited<ReturnType<typeof workflowData>>;
type CurrentStage = WorkflowData["stages"][number];

async function getTenantEpisode(organizationId: string, episodeId: string) {
  return getDb().select({ id: episodes.id }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
}

async function completionBlocker({ organizationId, episodeId, data, stage, includeSignOffs = true }: { organizationId: string; episodeId: string; data: WorkflowData; stage: CurrentStage; includeSignOffs?: boolean }) {
  const requiredRules = data.rules.filter((rule) => rule.workflowStageId === stage.id && rule.isRequired);
  if (includeSignOffs && requiredRules.some((rule) => !data.approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return "Every required sign-off must be recorded before this stage can complete.";
  return (await getOperationalWorkflowBlockers({ organizationId, episodeId, stage }))[0]?.message ?? null;
}

async function completeCurrentStage({ organizationId, episodeId, data, stage, actorUserId }: { organizationId: string; episodeId: string; data: WorkflowData; stage: CurrentStage; actorUserId: string }) {
  const db = getDb();
  const next = data.stages.find((candidate) => candidate.position > stage.position) ?? null;
  await db.update(episodes).set({
    workflowStageId: next?.id ?? stage.id,
    workflowStatus: next ? "not_started" : "complete",
    updatedAt: new Date(),
  }).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId), eq(episodes.workflowStageId, stage.id)));
  await db.insert(activityLog).values({ organizationId, actorUserId, action: "workflow.stage_completed", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, nextStage: next?.name ?? null } });
  return next;
}

/** A compact, tenant-scoped episode projection for operational clients. */
export async function GET(_: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (context.organization.role === "client") return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  if (!(await can("manage_shows")) && !(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const episode = await getEpisode(context.organization.organizationId, episodeId);
  return episode ? NextResponse.json({ episode }) : NextResponse.json({ error: "Episode not found." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const parsed = workflowActionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid workflow action." }, { status: 400 });
  const { episodeId } = await params;
  if (isDebugDemoMode) return NextResponse.json({ error: "Workflow actions require the database-backed debug environment." }, { status: 503 });
  if (!(await isAssignedToEpisode(episodeId))) return NextResponse.json({ error: "Episode not found." }, { status: 404 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const tenantEpisode = await getTenantEpisode(organizationId, episodeId);
  if (!tenantEpisode[0]) return NextResponse.json({ error: "Episode not found." }, { status: 404 });

  const data = await workflowData(organizationId, episodeId);
  const stage = data.stages.find((item) => item.id === parsed.data.workflowStageId);
  if (!data.episode || !stage) return NextResponse.json({ error: "Workflow stage not found." }, { status: 404 });

  const canUpdate = await canUpdateWorkflowWork(episodeId);
  const canSubmit = await canSubmitWorkflowTrack(episodeId);
  const canSignOff = await canSignOffWorkflowTrack(episodeId);
  const action = parsed.data.action;
  const db = getDb();

  // An early start creates the configured stage's work and an immutable audit
  // record, but does not turn it into a second active workflow state. The
  // episode still has exactly one current stage until ordinary progression
  // reaches this stage.
  if (action === "start_early") {
    const currentStage = data.stages.find((item) => item.id === data.episode.workflowStageId);
    if (!currentStage || stage.position <= currentStage.position) return NextResponse.json({ error: "Choose a future workflow stage to start early." }, { status: 409 });
    if (!stage.canStartEarly) return NextResponse.json({ error: "This stage is not configured to start early." }, { status: 409 });
    if (!(await can("authorize_early_starts"))) return NextResponse.json({ error: "You do not have permission to authorise an early start." }, { status: 403 });
    if (!parsed.data.reason) return NextResponse.json({ error: "Give a reason for the early start." }, { status: 400 });
    const [existing] = await db.select({ id: episodeWorkflowExceptions.id }).from(episodeWorkflowExceptions)
      .where(and(eq(episodeWorkflowExceptions.organizationId, organizationId), eq(episodeWorkflowExceptions.episodeId, episodeId), eq(episodeWorkflowExceptions.workflowStageId, stage.id), eq(episodeWorkflowExceptions.type, "early_start"))).limit(1);
    if (existing) return NextResponse.json({ error: "This early start has already been recorded." }, { status: 409 });
    await db.insert(episodeWorkflowExceptions).values({ organizationId, episodeId, workflowStageId: stage.id, type: "early_start", reason: parsed.data.reason, authorizedByUserId: context.userId });
    await createStageWorkOrders({ organizationId, episodeId, workflowStageId: stage.id, createdByUserId: context.userId });
    await db.insert(activityLog).values({ organizationId, actorUserId: context.userId, action: "workflow.stage_started_early", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, currentStage: currentStage.name, reason: parsed.data.reason } });
    return NextResponse.json({ ok: true, action, earlyStageId: stage.id });
  }

  if (data.episode.workflowStageId !== stage.id) return NextResponse.json({ error: "Only the episode's current workflow stage can be updated." }, { status: 409 });

  if (action === "block" || action === "resume") {
    if (!canUpdate) return NextResponse.json({ error: "You do not have permission to update this workflow stage." }, { status: 403 });
    if (!parsed.data.reason) return NextResponse.json({ error: `Give a reason to ${action === "resume" ? "resume" : "block"} this stage.` }, { status: 400 });
    if (action === "block") {
      if (!['in_progress', 'awaiting_sign_off'].includes(data.episode.workflowStatus)) return NextResponse.json({ error: "Only an active stage can be blocked." }, { status: 409 });
      await db.update(episodes).set({ workflowStatus: "blocked", updatedAt: new Date() }).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId)));
    } else {
      if (data.episode.workflowStatus !== "blocked") return NextResponse.json({ error: "This stage is not blocked." }, { status: 409 });
      const hasPendingSignOff = data.approvals.some((approval) => approval.workflowStageId === stage.id && approval.status === "pending");
      await db.update(episodes).set({ workflowStatus: hasPendingSignOff ? "awaiting_sign_off" : "in_progress", updatedAt: new Date() }).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId)));
    }
    await db.insert(activityLog).values({ organizationId, actorUserId: context.userId, action: action === "block" ? "workflow.stage_blocked" : "workflow.stage_resumed", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, reason: parsed.data.reason } });
    return NextResponse.json({ ok: true, action });
  }

  if (action === "start") {
    if (!canUpdate) return NextResponse.json({ error: "You do not have permission to start this workflow stage." }, { status: 403 });
    if (data.episode.workflowStatus !== "not_started") return NextResponse.json({ error: "This workflow stage is already active or complete." }, { status: 409 });
    await db.update(episodes).set({ workflowStatus: "in_progress", updatedAt: new Date() }).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId)));
    await createStageWorkOrders({ organizationId, episodeId, workflowStageId: stage.id, createdByUserId: context.userId });
    await db.insert(activityLog).values({ organizationId, actorUserId: context.userId, action: "workflow.stage_started", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name } });
    return NextResponse.json({ ok: true, action });
  }

  if (action === "submit") {
    if (!canSubmit) return NextResponse.json({ error: "You do not have permission to submit this workflow stage." }, { status: 403 });
    if (data.episode.workflowStatus !== "in_progress") return NextResponse.json({ error: "Only an in-progress stage can be submitted for sign-off." }, { status: 409 });
    const requiredRules = data.rules.filter((rule) => rule.workflowStageId === stage.id && rule.isRequired);
    if (!requiredRules.length) {
      const blocker = await completionBlocker({ organizationId, episodeId, data, stage, includeSignOffs: false });
      if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
      await db.insert(activityLog).values({ organizationId, actorUserId: context.userId, action: "workflow.stage_submitted", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, signOffRequired: false } });
      const next = await completeCurrentStage({ organizationId, episodeId, data, stage, actorUserId: context.userId });
      return NextResponse.json({ ok: true, action, stageComplete: true, nextStageId: next?.id ?? null });
    }
    const signerRoutes = await resolveEpisodeWorkflowSigners(organizationId, episodeId, requiredRules);
    if (signerRoutes.some((route) => !route.signer)) return NextResponse.json({ error: "Choose each episode workflow signer before this stage can be submitted." }, { status: 409 });
    await db.insert(episodeWorkflowApprovals).values(signerRoutes.map((route) => ({ organizationId, episodeId, workflowStageId: stage.id, approvalRuleId: route.ruleId, approverRole: null, requiredPersonId: route.signer!.personId, status: "pending" as const }))).onConflictDoNothing();
    await db.update(episodes).set({ workflowStatus: "awaiting_sign_off", updatedAt: new Date() }).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId)));
    await db.insert(activityLog).values({ organizationId, actorUserId: context.userId, action: "workflow.stage_submitted", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name } });
    return NextResponse.json({ ok: true, action });
  }

  if (!canSignOff) return NextResponse.json({ error: "You do not have permission to sign off this workflow stage." }, { status: 403 });
  if (data.episode.workflowStatus !== "awaiting_sign_off") return NextResponse.json({ error: "Submit this workflow stage for sign-off before recording a sign-off." }, { status: 409 });
  const rules = data.rules.filter((rule) => rule.workflowStageId === stage.id);
  if (!rules.length) return NextResponse.json({ error: "This workflow stage has no configured sign-offs." }, { status: 409 });
  const [person] = await db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.userId, context.userId))).limit(1);
  if (!person) return NextResponse.json({ error: "Your account is not set up as a named workflow approver." }, { status: 403 });
  const approvals = data.approvals.filter((approval) => approval.workflowStageId === stage.id);
  const candidate = parsed.data.approvalRuleId
    ? rules.find((rule) => rule.id === parsed.data.approvalRuleId && !approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))
    : rules.find((rule) => rule.isRequired && !approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"));
  if (!candidate) return NextResponse.json({ error: "Every configured sign-off has already been recorded for this stage." }, { status: 409 });
  if (rules.some((rule) => rule.isRequired && rule.approvalOrder < candidate.approvalOrder && !approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return NextResponse.json({ error: "Complete the earlier required sign-offs first." }, { status: 409 });
  const signer = (await resolveEpisodeWorkflowSigners(organizationId, episodeId, [candidate]))[0]?.signer;
  if (!signer) return NextResponse.json({ error: "Choose the episode workflow signer before this stage can be signed off." }, { status: 409 });
  if (signer.personId !== person.id) return NextResponse.json({ error: "This sign-off is assigned to another episode-team member." }, { status: 403 });
  const operationalBlocker = await completionBlocker({ organizationId, episodeId, data, stage, includeSignOffs: false });
  if (operationalBlocker) return NextResponse.json({ error: operationalBlocker }, { status: 409 });
  const existing = approvals.find((approval) => approval.approvalRuleId === candidate.id);
  if (!existing) return NextResponse.json({ error: "This sign-off request is no longer available." }, { status: 409 });
  const updated = await db.update(episodeWorkflowApprovals).set({ status: "approved", requiredPersonId: person.id, approverPersonId: person.id, comment: parsed.data.comment || null, respondedAt: new Date(), updatedAt: new Date() }).where(and(eq(episodeWorkflowApprovals.id, existing.id), eq(episodeWorkflowApprovals.organizationId, organizationId), eq(episodeWorkflowApprovals.status, "pending"))).returning({ id: episodeWorkflowApprovals.id });
  if (!updated.length) return NextResponse.json({ error: "This sign-off has already been recorded." }, { status: 409 });
  await db.insert(activityLog).values({ organizationId, actorUserId: context.userId, action: "workflow.signed_off", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, approvalRuleId: candidate.id, approverRole: candidate.approverRole, isRequired: candidate.isRequired, comment: parsed.data.comment || null } });
  const refreshed = await workflowData(organizationId, episodeId);
  const blocker = await completionBlocker({ organizationId, episodeId, data: refreshed, stage });
  if (!blocker) {
    const next = await completeCurrentStage({ organizationId, episodeId, data: refreshed, stage, actorUserId: context.userId });
    return NextResponse.json({ ok: true, action, approvalRuleId: candidate.id, stageComplete: true, nextStageId: next?.id ?? null });
  }
  return NextResponse.json({ ok: true, action, approvalRuleId: candidate.id, stageComplete: false, completionBlockedBy: blocker });
}
