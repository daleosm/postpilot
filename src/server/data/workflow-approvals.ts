import "server-only";

import { and, asc, eq, inArray, notInArray, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, episodeWorkflowApprovals, episodeWorkflowTracks, episodes, people, postWorkOrders, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { resolveEpisodeWorkflowSigners } from "@/lib/workflow-signoffs";

/** Whether the user has an episode-team or active work-order connection to this post house. */
export async function hasApprovalWorkspace(organizationId: string, userId: string) {
  const db = getDb();
  const [person] = await db.select({ id: people.id, role: people.role }).from(people)
    .where(and(eq(people.organizationId, organizationId), eq(people.userId, userId))).limit(1);
  if (!person) return false;

  const [teamAssignment, workOrder] = await Promise.all([
    db.select({ id: episodeTeamAssignments.id }).from(episodeTeamAssignments)
      .innerJoin(episodes, eq(episodeTeamAssignments.episodeId, episodes.id))
      .where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.personId, person.id), eq(episodes.organizationId, organizationId))).limit(1),
    db.select({ id: postWorkOrders.id }).from(postWorkOrders)
      .where(and(eq(postWorkOrders.organizationId, organizationId), notInArray(postWorkOrders.status, ["complete", "cancelled"]), or(eq(postWorkOrders.assigneePersonId, person.id), eq(postWorkOrders.assigneeRole, person.role)))).limit(1),
  ]);
  return Boolean(teamAssignment[0] || workOrder[0]);
}

/** Current workflow stages for which this user is the next configured sign-off. */
export async function listWorkflowSignOffInbox(organizationId: string, userId: string) {
  const db = getDb();
  const [person] = await db.select({ id: people.id }).from(people)
    .where(and(eq(people.organizationId, organizationId), eq(people.userId, userId))).limit(1);
  if (!person) return [];

  const primaryStageRules = await db.select({
    episodeId: episodes.id,
    showId: shows.id,
    workflowStageId: workflowStages.id,
    stageName: workflowStages.name,
    stagePosition: workflowStages.position,
    ruleId: workflowStageApprovalRules.id,
    signOffLabel: workflowStageApprovalRules.label,
    approverRole: workflowStageApprovalRules.approverRole,
    approvalOrder: workflowStageApprovalRules.approvalOrder,
    isRequired: workflowStageApprovalRules.isRequired,
    passedAt: episodes.updatedAt,
    showTitle: shows.title,
    episodeTitle: episodes.title,
    episodeNumber: episodes.number,
  }).from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .innerJoin(workflowStages, eq(episodes.workflowStageId, workflowStages.id))
    .innerJoin(workflowStageApprovalRules, eq(workflowStageApprovalRules.workflowStageId, workflowStages.id))
    .where(and(
      eq(episodes.organizationId, organizationId),
      eq(seasons.organizationId, organizationId),
      eq(shows.organizationId, organizationId),
      eq(workflowStages.organizationId, organizationId),
      eq(workflowStageApprovalRules.organizationId, organizationId),
    )).orderBy(asc(workflowStages.position), asc(workflowStageApprovalRules.approvalOrder));
  const trackedStageRules = await db.select({
    episodeId: episodes.id,
    showId: shows.id,
    workflowStageId: workflowStages.id,
    stageName: workflowStages.name,
    stagePosition: workflowStages.position,
    ruleId: workflowStageApprovalRules.id,
    signOffLabel: workflowStageApprovalRules.label,
    approverRole: workflowStageApprovalRules.approverRole,
    approvalOrder: workflowStageApprovalRules.approvalOrder,
    isRequired: workflowStageApprovalRules.isRequired,
    passedAt: episodeWorkflowTracks.startedAt,
    showTitle: shows.title,
    episodeTitle: episodes.title,
    episodeNumber: episodes.number,
  }).from(episodeWorkflowTracks)
    .innerJoin(episodes, eq(episodeWorkflowTracks.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .innerJoin(workflowStages, eq(episodeWorkflowTracks.workflowStageId, workflowStages.id))
    .innerJoin(workflowStageApprovalRules, eq(workflowStageApprovalRules.workflowStageId, workflowStages.id))
    .where(and(
      eq(episodeWorkflowTracks.organizationId, organizationId),
      inArray(episodeWorkflowTracks.status, ["in_progress", "submitted", "blocked"]),
      eq(episodes.organizationId, organizationId),
      eq(seasons.organizationId, organizationId),
      eq(shows.organizationId, organizationId),
      eq(workflowStages.organizationId, organizationId),
      eq(workflowStageApprovalRules.organizationId, organizationId),
    )).orderBy(asc(workflowStages.position), asc(workflowStageApprovalRules.approvalOrder));
  const stageRules = [...primaryStageRules, ...trackedStageRules];
  if (!stageRules.length) return [];

  const episodeIds = [...new Set(stageRules.map((rule) => rule.episodeId))];
  const approvals = await db.select({ episodeId: episodeWorkflowApprovals.episodeId, workflowStageId: episodeWorkflowApprovals.workflowStageId, approvalRuleId: episodeWorkflowApprovals.approvalRuleId, requiredPersonId: episodeWorkflowApprovals.requiredPersonId, status: episodeWorkflowApprovals.status })
    .from(episodeWorkflowApprovals)
    .where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), inArray(episodeWorkflowApprovals.episodeId, episodeIds)));
  const approvalsByStage = new Map<string, Set<string>>();
  for (const approval of approvals) {
    if (approval.status !== "approved") continue;
    const key = `${approval.episodeId}:${approval.workflowStageId}`;
    approvalsByStage.set(key, new Set([...(approvalsByStage.get(key) ?? []), approval.approvalRuleId]));
  }
  const byStage = new Map<string, typeof stageRules>();
  for (const rule of stageRules) {
    const key = `${rule.episodeId}:${rule.workflowStageId}`;
    byStage.set(key, [...(byStage.get(key) ?? []), rule]);
  }

  return (await Promise.all([...byStage.entries()].map(async ([, rules]) => {
    const approved = approvalsByStage.get(`${rules[0].episodeId}:${rules[0].workflowStageId}`) ?? new Set<string>();
    const readyRules = rules.filter((rule) => !approved.has(rule.ruleId) && !rules.some((previous) => previous.isRequired && previous.approvalOrder < rule.approvalOrder && !approved.has(previous.ruleId)));
    return (await Promise.all(readyRules.map(async (rule) => {
      const signer = (await resolveEpisodeWorkflowSigners(organizationId, rule.episodeId, [{ id: rule.ruleId, approverRole: rule.approverRole }]))[0]?.signer;
      const requiredPersonId = signer?.personId ?? null;
      return requiredPersonId === person.id ? { ...rule, id: `${rule.episodeId}:${rule.ruleId}`, approvalRuleId: rule.ruleId } : null;
    }))).filter((item) => item !== null);
  }))).flat();
}
