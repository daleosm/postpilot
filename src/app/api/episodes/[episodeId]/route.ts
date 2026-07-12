import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { activityLog, episodeWorkflowApprovals, episodeWorkflowTracks, episodes, people, postWorkflows, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { can } from "@/lib/permissions";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { defaultEpisodicApprovalRules, defaultEpisodicWorkflow, statusForWorkflowKey } from "@/lib/workflow";

const stageUpdateSchema = z.object({ workflowStageId: z.string().min(1) });
const approvalActionSchema = z.object({ workflowStageId: z.string().min(1), action: z.literal("sign_off"), comment: z.string().trim().max(2000).optional() });
const DEBUG_WORKFLOW_COOKIE = "postpilot.debugEpisodeWorkflows";
const DEBUG_WORKFLOW_APPROVALS_COOKIE = "postpilot.debugWorkflowApprovals";

export async function PATCH(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  if (!(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = stageUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a workflow stage." }, { status: 400 });
  const { episodeId } = await params;

  if (isDebugDemoMode) {
    const stage = defaultEpisodicWorkflow.find((item) => item.id === parsed.data.workflowStageId);
    if (!stage) return NextResponse.json({ error: "Workflow stage not found." }, { status: 404 });
    const stored = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEBUG_WORKFLOW_COOKIE}=`))?.slice(DEBUG_WORKFLOW_COOKIE.length + 1);
    let workflows: Record<string, string> = {}; try { workflows = JSON.parse(stored ? decodeURIComponent(stored) : "{}"); } catch { workflows = {}; }
    workflows[episodeId] = stage.id;
    const response = NextResponse.json({ ok: true, debug: true, workflowStage: stage });
    response.cookies.set(DEBUG_WORKFLOW_COOKIE, JSON.stringify(workflows), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  }

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const [[episode], [stage]] = await Promise.all([
    db.select({ id: episodes.id, workflowStageId: episodes.workflowStageId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key, position: workflowStages.position, canStartEarly: workflowStages.canStartEarly }).from(workflowStages).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id)).where(and(eq(workflowStages.id, parsed.data.workflowStageId), eq(workflowStages.organizationId, context.organization.organizationId), eq(postWorkflows.organizationId, context.organization.organizationId))).limit(1),
  ]);
  if (!episode || !stage) return NextResponse.json({ error: "Episode or workflow stage not found." }, { status: 404 });
  if (episode.workflowStageId && episode.workflowStageId !== stage.id) {
    if (!stage.canStartEarly) {
      const [currentStage] = await db.select({ id: workflowStages.id, position: workflowStages.position }).from(workflowStages).where(and(eq(workflowStages.id, episode.workflowStageId), eq(workflowStages.organizationId, context.organization.organizationId))).limit(1);
      if (!currentStage || stage.position !== currentStage.position + 1) return NextResponse.json({ error: "Workflow stages normally proceed in order. Enable Allow early start in workflow settings to make an exception." }, { status: 409 });
      const [rules, approvals] = await Promise.all([
        db.select({ id: workflowStageApprovalRules.id }).from(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.organizationId, context.organization.organizationId), eq(workflowStageApprovalRules.workflowStageId, episode.workflowStageId))),
        db.select({ approvalRuleId: episodeWorkflowApprovals.approvalRuleId, status: episodeWorkflowApprovals.status }).from(episodeWorkflowApprovals).where(and(eq(episodeWorkflowApprovals.organizationId, context.organization.organizationId), eq(episodeWorkflowApprovals.episodeId, episode.id), eq(episodeWorkflowApprovals.workflowStageId, episode.workflowStageId))),
      ]);
      if (!rules.length || !rules.every((rule) => approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return NextResponse.json({ error: "Complete every configured sign-off for the current stage before advancing." }, { status: 409 });
    }
  }
  await db.update(episodes).set({ workflowStageId: stage.id, status: statusForWorkflowKey(stage.key), updatedAt: new Date() }).where(and(eq(episodes.id, episode.id), eq(episodes.organizationId, context.organization.organizationId)));
  if (["vfx_graphics_titles", "online_conform", "colour_grade", "sound_editorial_adr_foley_music", "final_mix"].includes(stage.key)) {
    await db.insert(episodeWorkflowTracks).values({ organizationId: context.organization.organizationId, episodeId: episode.id, workflowStageId: stage.id, status: "in_progress", startedAt: new Date() })
      .onConflictDoUpdate({ target: [episodeWorkflowTracks.episodeId, episodeWorkflowTracks.workflowStageId], set: { status: "in_progress", startedAt: new Date(), updatedAt: new Date(), blockedReason: null } });
  }
  return NextResponse.json({ ok: true, workflowStage: stage });
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const parsed = approvalActionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid workflow sign-off action." }, { status: 400 });
  const { episodeId } = await params;
  if (isDebugDemoMode) {
    const stored = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEBUG_WORKFLOW_APPROVALS_COOKIE}=`))?.slice(DEBUG_WORKFLOW_APPROVALS_COOKIE.length + 1);
    let state: Record<string, Record<string, Record<string, "pending" | "approved" | "changes_requested">>> = {}; try { state = JSON.parse(stored ? decodeURIComponent(stored) : "{}"); } catch { state = {}; }
    const stageRules = defaultEpisodicApprovalRules.filter((rule) => rule.workflowStageId === parsed.data.workflowStageId).sort((a, b) => a.approvalOrder - b.approvalOrder);
    if (!stageRules.length) return NextResponse.json({ error: "Workflow stage not found." }, { status: 404 });
    const stageState = state[episodeId]?.[parsed.data.workflowStageId] ?? {};
    const target = stageRules.find((rule) => stageState[rule.id] !== "approved");
    if (!target) return NextResponse.json({ error: "All configured sign-offs are already recorded." }, { status: 409 });
    stageState[target.id] = "approved";
    state[episodeId] ??= {}; state[episodeId][parsed.data.workflowStageId] = stageState;
    const response = NextResponse.json({ ok: true, debug: true, action: parsed.data.action, approvalRuleId: target.id, stageComplete: stageRules.every((rule) => stageState[rule.id] === "approved") });
    response.cookies.set(DEBUG_WORKFLOW_APPROVALS_COOKIE, JSON.stringify(state), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  }

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [[episode], [stage], [person]] = await Promise.all([
    db.select({ id: episodes.id, workflowStageId: episodes.workflowStageId, qcStatus: episodes.qcStatus }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key }).from(workflowStages).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id)).where(and(eq(workflowStages.id, parsed.data.workflowStageId), eq(workflowStages.organizationId, context.organization.organizationId), eq(postWorkflows.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1),
  ]);
  if (!episode || !stage) return NextResponse.json({ error: "Episode or workflow stage not found." }, { status: 404 });
  if (episode.workflowStageId !== stage.id) return NextResponse.json({ error: "Only the current workflow stage can be signed off." }, { status: 409 });

  if (!person) return NextResponse.json({ error: "Your account is not set up as a named workflow approver." }, { status: 403 });
  const [rules, approvals] = await Promise.all([
    db.select({ id: workflowStageApprovalRules.id, approverRole: workflowStageApprovalRules.approverRole, approvalOrder: workflowStageApprovalRules.approvalOrder, isRequired: workflowStageApprovalRules.isRequired })
      .from(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.organizationId, organizationId), eq(workflowStageApprovalRules.workflowStageId, stage.id))).orderBy(workflowStageApprovalRules.approvalOrder),
    db.select({ id: episodeWorkflowApprovals.id, approvalRuleId: episodeWorkflowApprovals.approvalRuleId, status: episodeWorkflowApprovals.status })
      .from(episodeWorkflowApprovals).where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), eq(episodeWorkflowApprovals.episodeId, episodeId), eq(episodeWorkflowApprovals.workflowStageId, stage.id))),
  ]);
  if (!rules.length) return NextResponse.json({ error: "This workflow stage has no configured sign-offs." }, { status: 409 });
  const roleMatches = (requiredRole: string) => requiredRole === person.role || (requiredRole === "director" && person.role === "client") || (requiredRole === "network" && ["network", "client"].includes(person.role));
  const candidate = rules.find((rule) => !approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved") && roleMatches(rule.approverRole));
  if (!candidate) return NextResponse.json({ error: "Your role is not the next required sign-off for this stage, or it has already been recorded." }, { status: 403 });
  if (rules.some((rule) => rule.approvalOrder < candidate.approvalOrder && !approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return NextResponse.json({ error: "Complete the earlier sign-offs first." }, { status: 409 });
  const existingApproval = approvals.find((approval) => approval.approvalRuleId === candidate.id);
  if (existingApproval) {
    await db.update(episodeWorkflowApprovals).set({ status: "approved", requiredPersonId: person.id, approverPersonId: person.id, comment: parsed.data.comment || null, respondedAt: new Date(), updatedAt: new Date() }).where(and(eq(episodeWorkflowApprovals.id, existingApproval.id), eq(episodeWorkflowApprovals.organizationId, organizationId)));
  } else {
    await db.insert(episodeWorkflowApprovals).values({ organizationId, episodeId, workflowStageId: stage.id, approvalRuleId: candidate.id, approverRole: candidate.approverRole, requiredPersonId: person.id, approverPersonId: person.id, status: "approved", comment: parsed.data.comment || null, respondedAt: new Date() });
  }
  const stageWillBeApproved = rules.every((rule) => rule.id === candidate.id || approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"));
  if (stageWillBeApproved && ["vfx_graphics_titles", "online_conform", "colour_grade", "sound_editorial_adr_foley_music", "final_mix"].includes(stage.key)) {
    await db.insert(episodeWorkflowTracks).values({ organizationId: context.organization.organizationId, episodeId, workflowStageId: stage.id, status: "approved", completedAt: new Date() })
      .onConflictDoUpdate({ target: [episodeWorkflowTracks.episodeId, episodeWorkflowTracks.workflowStageId], set: { status: "approved", completedAt: new Date(), updatedAt: new Date() } });
  }
  await db.insert(activityLog).values({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "workflow.signed_off", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, approverRole: candidate.approverRole } });
  return NextResponse.json({ ok: true, status: "approved", approvalRuleId: candidate.id, stageComplete: stageWillBeApproved });
}
