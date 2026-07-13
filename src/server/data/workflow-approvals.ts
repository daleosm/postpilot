import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodeWorkflowApprovals, episodes, people, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";

/** Current workflow stages for which this user is the next configured sign-off. */
export async function listWorkflowSignOffInbox(organizationId: string, userId: string) {
  const db = getDb();
  const [person] = await db.select({ id: people.id, role: people.role }).from(people)
    .where(and(eq(people.organizationId, organizationId), eq(people.userId, userId))).limit(1);
  if (!person) return [];

  const stageRules = await db.select({
    episodeId: episodes.id,
    showId: shows.id,
    workflowStageId: workflowStages.id,
    stageName: workflowStages.name,
    stagePosition: workflowStages.position,
    ruleId: workflowStageApprovalRules.id,
    signOffLabel: workflowStageApprovalRules.label,
    approverRole: workflowStageApprovalRules.approverRole,
    approvalOrder: workflowStageApprovalRules.approvalOrder,
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
  if (!stageRules.length) return [];

  const episodeIds = [...new Set(stageRules.map((rule) => rule.episodeId))];
  const approvals = await db.select({ episodeId: episodeWorkflowApprovals.episodeId, workflowStageId: episodeWorkflowApprovals.workflowStageId, approvalRuleId: episodeWorkflowApprovals.approvalRuleId, status: episodeWorkflowApprovals.status })
    .from(episodeWorkflowApprovals)
    .where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), inArray(episodeWorkflowApprovals.episodeId, episodeIds)));
  const approvalsByStage = new Map<string, Set<string>>();
  for (const approval of approvals) {
    if (approval.status !== "approved") continue;
    const key = `${approval.episodeId}:${approval.workflowStageId}`;
    approvalsByStage.set(key, new Set([...(approvalsByStage.get(key) ?? []), approval.approvalRuleId]));
  }
  const roleMatches = (role: string) => role === person.role;
  const byStage = new Map<string, typeof stageRules>();
  for (const rule of stageRules) {
    const key = `${rule.episodeId}:${rule.workflowStageId}`;
    byStage.set(key, [...(byStage.get(key) ?? []), rule]);
  }

  return [...byStage.entries()].flatMap(([, rules]) => {
    const approved = approvalsByStage.get(`${rules[0].episodeId}:${rules[0].workflowStageId}`) ?? new Set<string>();
    const nextRule = rules.find((rule) => !approved.has(rule.ruleId));
    if (!nextRule || !roleMatches(nextRule.approverRole)) return [];
    return [{ ...nextRule, id: `${nextRule.episodeId}:${nextRule.ruleId}` }];
  });
}
