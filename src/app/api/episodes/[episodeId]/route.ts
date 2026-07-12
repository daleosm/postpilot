import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { activityLog, episodeWorkflowApprovals, episodeWorkflowTracks, episodes, people, postWorkflows, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { can, isAssignedToEpisode } from "@/lib/permissions";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { defaultEpisodicApprovalRules, defaultEpisodicWorkflow, statusForWorkflowKey } from "@/lib/workflow";

const stageUpdateSchema = z.object({ workflowStageId: z.string().min(1) });
const approvalActionSchema = z.object({ workflowStageId: z.string().min(1), action: z.enum(["submit", "approve", "request_changes"]), comment: z.string().trim().max(2000).optional(), assignments: z.array(z.object({ ruleId: z.string().uuid(), personId: z.string().uuid() })).optional() });
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
        db.select({ id: workflowStageApprovalRules.id }).from(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.organizationId, context.organization.organizationId), eq(workflowStageApprovalRules.workflowStageId, episode.workflowStageId), eq(workflowStageApprovalRules.isRequired, true))),
        db.select({ approvalRuleId: episodeWorkflowApprovals.approvalRuleId, status: episodeWorkflowApprovals.status }).from(episodeWorkflowApprovals).where(and(eq(episodeWorkflowApprovals.organizationId, context.organization.organizationId), eq(episodeWorkflowApprovals.episodeId, episode.id), eq(episodeWorkflowApprovals.workflowStageId, episode.workflowStageId))),
      ]);
      if (!rules.length || !rules.every((rule) => approvals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return NextResponse.json({ error: "Complete all required approvals for the current stage before advancing." }, { status: 409 });
    }
  }
  await db.update(episodes).set({ workflowStageId: stage.id, status: statusForWorkflowKey(stage.key), updatedAt: new Date() }).where(and(eq(episodes.id, episode.id), eq(episodes.organizationId, context.organization.organizationId)));
  if (["vfx_graphics_titles", "colour_online_conform", "sound_final_mix"].includes(stage.key)) {
    await db.insert(episodeWorkflowTracks).values({ organizationId: context.organization.organizationId, episodeId: episode.id, workflowStageId: stage.id, status: "in_progress", startedAt: new Date() })
      .onConflictDoUpdate({ target: [episodeWorkflowTracks.episodeId, episodeWorkflowTracks.workflowStageId], set: { status: "in_progress", startedAt: new Date(), updatedAt: new Date(), blockedReason: null } });
  }
  return NextResponse.json({ ok: true, workflowStage: stage });
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const parsed = approvalActionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid workflow approval action." }, { status: 400 });
  const { episodeId } = await params;
  if (isDebugDemoMode) {
    const stored = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEBUG_WORKFLOW_APPROVALS_COOKIE}=`))?.slice(DEBUG_WORKFLOW_APPROVALS_COOKIE.length + 1);
    let state: Record<string, Record<string, Record<string, "pending" | "approved" | "changes_requested">>> = {}; try { state = JSON.parse(stored ? decodeURIComponent(stored) : "{}"); } catch { state = {}; }
    const stageRules = defaultEpisodicApprovalRules.filter((rule) => rule.workflowStageId === parsed.data.workflowStageId).sort((a, b) => a.approvalOrder - b.approvalOrder);
    if (!stageRules.length) return NextResponse.json({ error: "Workflow stage not found." }, { status: 404 });
    const stageState = state[episodeId]?.[parsed.data.workflowStageId] ?? {};
    if (parsed.data.action === "submit") stageRules.forEach((rule) => { stageState[rule.id] ??= "pending"; });
    else {
      const target = stageRules.find((rule) => stageState[rule.id] === "pending");
      if (!target) return NextResponse.json({ error: "All expected approvals are already recorded." }, { status: 409 });
      stageState[target.id] = parsed.data.action === "approve" ? "approved" : "changes_requested";
    }
    state[episodeId] ??= {}; state[episodeId][parsed.data.workflowStageId] = stageState;
    const response = NextResponse.json({ ok: true, debug: true, action: parsed.data.action });
    response.cookies.set(DEBUG_WORKFLOW_APPROVALS_COOKIE, JSON.stringify(state), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  }

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [[episode], [stage], [person]] = await Promise.all([
    db.select({ id: episodes.id, qcStatus: episodes.qcStatus }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key }).from(workflowStages).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id)).where(and(eq(workflowStages.id, parsed.data.workflowStageId), eq(workflowStages.organizationId, context.organization.organizationId), eq(postWorkflows.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1),
  ]);
  if (!episode || !stage) return NextResponse.json({ error: "Episode or workflow stage not found." }, { status: 404 });

  if (parsed.data.action === "submit") {
    const mayManage = await can("manage_shows");
    if (!mayManage && (!(await can("update_tasks")) || !(await isAssignedToEpisode(episodeId)))) return NextResponse.json({ error: "Only the assigned post team can submit a stage for approval." }, { status: 403 });
    const rules = await db.select().from(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.organizationId, organizationId), eq(workflowStageApprovalRules.workflowStageId, stage.id)));
    if (!rules.length) return NextResponse.json({ error: "This workflow stage has no approval policy." }, { status: 409 });
    const assignments = new Map((parsed.data.assignments ?? []).map((assignment) => [assignment.ruleId, assignment.personId]));
    const assignees = assignments.size ? await db.select({ id: people.id, role: people.role }).from(people).where(eq(people.organizationId, context.organization.organizationId)) : [];
    const roleMatches = (requiredRole: string, actualRole: string) => requiredRole === actualRole || (requiredRole === "director" && actualRole === "client") || (requiredRole === "network" && ["network", "client"].includes(actualRole));
    if (rules.some((rule) => rule.isRequired && (!assignments.get(rule.id) || !assignees.some((person) => person.id === assignments.get(rule.id) && roleMatches(rule.approverRole, person.role))))) return NextResponse.json({ error: "Assign a valid named approver to every required approval before submitting." }, { status: 400 });
    await db.insert(episodeWorkflowApprovals).values(rules.map((rule) => ({ organizationId, episodeId, workflowStageId: stage.id, approvalRuleId: rule.id, approverRole: rule.approverRole, requiredPersonId: assignments.get(rule.id) ?? null, comment: null }))).onConflictDoNothing();
    await db.insert(activityLog).values({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: "workflow.submitted_for_approval", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name } });
    return NextResponse.json({ ok: true, status: "ready_for_approval" });
  }

  if (!person) return NextResponse.json({ error: "Your account is not set up as a named workflow approver." }, { status: 403 });
  const approvals = await db.select({ id: episodeWorkflowApprovals.id, approverRole: episodeWorkflowApprovals.approverRole, requiredPersonId: episodeWorkflowApprovals.requiredPersonId, status: episodeWorkflowApprovals.status, approvalOrder: workflowStageApprovalRules.approvalOrder, isRequired: workflowStageApprovalRules.isRequired })
    .from(episodeWorkflowApprovals).innerJoin(workflowStageApprovalRules, eq(episodeWorkflowApprovals.approvalRuleId, workflowStageApprovalRules.id))
    .where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), eq(workflowStageApprovalRules.organizationId, organizationId), eq(episodeWorkflowApprovals.episodeId, episodeId), eq(episodeWorkflowApprovals.workflowStageId, stage.id)));
  const roleMatches = (requiredRole: string) => requiredRole === person.role || (requiredRole === "director" && person.role === "client") || (requiredRole === "network" && ["network", "client"].includes(person.role));
  const candidate = approvals.sort((a, b) => a.approvalOrder - b.approvalOrder).find((approval) => approval.status === "pending" && roleMatches(approval.approverRole) && approval.requiredPersonId === person.id);
  if (!candidate) return NextResponse.json({ error: "You are not an expected approver for this stage, or your approval has already been recorded." }, { status: 403 });
  if (parsed.data.action === "approve" && approvals.some((approval) => approval.isRequired && approval.approvalOrder < candidate.approvalOrder && approval.status !== "approved")) return NextResponse.json({ error: "Complete the earlier required approvals first." }, { status: 409 });
  await db.update(episodeWorkflowApprovals).set({ status: parsed.data.action === "approve" ? "approved" : "changes_requested", approverPersonId: person?.id ?? null, comment: parsed.data.comment || null, respondedAt: new Date(), updatedAt: new Date() }).where(and(eq(episodeWorkflowApprovals.id, candidate.id), eq(episodeWorkflowApprovals.organizationId, organizationId)));
  const stageWillBeApproved = parsed.data.action === "approve" && approvals.filter((approval) => approval.isRequired).every((approval) => approval.id === candidate.id || approval.status === "approved");
  if (stageWillBeApproved && ["vfx_graphics_titles", "colour_online_conform", "sound_final_mix"].includes(stage.key)) {
    await db.insert(episodeWorkflowTracks).values({ organizationId: context.organization.organizationId, episodeId, workflowStageId: stage.id, status: "approved", completedAt: new Date() })
      .onConflictDoUpdate({ target: [episodeWorkflowTracks.episodeId, episodeWorkflowTracks.workflowStageId], set: { status: "approved", completedAt: new Date(), updatedAt: new Date() } });
  }
  await db.insert(activityLog).values({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: parsed.data.action === "approve" ? "workflow.approved" : "workflow.changes_requested", entityType: "episode", entityId: episodeId, metadata: { stage: stage.name, approverRole: candidate.approverRole } });
  return NextResponse.json({ ok: true, status: parsed.data.action === "approve" ? "approved" : "changes_requested" });
}
