import "server-only";

import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { clientShares, episodeWorkflowApprovals, episodes, people, reviewCuts, reviewNotes, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";

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
  const roleMatches = (role: string) => role === person.role || (role === "director" && person.role === "client") || (role === "network" && ["network", "client"].includes(person.role));
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

export async function listReviewQueue(organizationId: string) {
  const db = getDb();
  const cuts = await listReviewCuts(organizationId);
  const notes = await db.select({ reviewCutId: reviewNotes.reviewCutId, status: reviewNotes.status }).from(reviewNotes)
    .where(eq(reviewNotes.organizationId, organizationId));
  return cuts.map((cut) => ({ ...cut, openNoteCount: notes.filter((note) => note.reviewCutId === cut.id && note.status === "open").length }));
}

/**
 * The review index is also the client/studio workspace. Start with the
 * tenant-scoped queue so note counts are retained, then apply the same share
 * rules used by the item detail route. This is a convenience filter only:
 * `getReviewCutWorkspace` and the note APIs still enforce tenant ownership.
 */
export async function listReviewQueueForUser(organizationId: string, userId: string) {
  const [queue, visibleCuts] = await Promise.all([
    listReviewQueue(organizationId),
    listReviewCutsForUser(organizationId, userId),
  ]);
  const visibleIds = new Set(visibleCuts.map((cut) => cut.id));
  return queue.filter((item) => visibleIds.has(item.id));
}

export async function listReviewCuts(organizationId: string) {
  const db = getDb();
  return db.select({
    id: reviewCuts.id, title: reviewCuts.title, version: reviewCuts.version, runtimeSeconds: reviewCuts.runtimeSeconds, status: reviewCuts.status, approvalStatus: reviewCuts.approvalStatus, submittedAt: reviewCuts.submittedAt, dueAt: reviewCuts.dueAt,
    organizationId: shows.organizationId, showId: shows.id, episodeId: episodes.id, episodeTitle: episodes.title, episodeNumber: episodes.number, showTitle: shows.title,
  }).from(reviewCuts).innerJoin(episodes, eq(reviewCuts.episodeId, episodes.id)).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(reviewCuts.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).orderBy(desc(reviewCuts.submittedAt));
}

/** External reviewers only see cuts shared directly, by episode, or by show. */
export async function listReviewCutsForUser(organizationId: string, userId: string) {
  const db = getDb();
  const [person] = await db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.userId, userId))).limit(1);
  const cuts = await listReviewCuts(organizationId);
  if (!person || !["client", "director", "network"].includes(person.role)) return cuts;
  const shares = await db.select({ showId: clientShares.showId, episodeId: clientShares.episodeId, reviewCutId: clientShares.reviewCutId })
    .from(clientShares).where(and(eq(clientShares.organizationId, organizationId), eq(clientShares.clientPersonId, person.id), or(isNull(clientShares.expiresAt), gt(clientShares.expiresAt, new Date()))));
  return cuts.filter((cut) => shares.some((share) => share.reviewCutId === cut.id || share.episodeId === cut.episodeId || share.showId === cut.showId));
}

export async function listReviewNotes(organizationId: string, reviewCutId: string) {
  const db = getDb();
  return db.select().from(reviewNotes)
    .where(and(eq(reviewNotes.organizationId, organizationId), eq(reviewNotes.reviewCutId, reviewCutId)))
    .orderBy(desc(reviewNotes.createdAt));
}

export async function getReviewCutWorkspace(organizationId: string, reviewCutId: string) {
  const db = getDb();
  const [cut] = await db.select({
    id: reviewCuts.id, title: reviewCuts.title, version: reviewCuts.version, runtimeSeconds: reviewCuts.runtimeSeconds, status: reviewCuts.status, approvalStatus: reviewCuts.approvalStatus, submittedAt: reviewCuts.submittedAt, dueAt: reviewCuts.dueAt,
    organizationId: shows.organizationId, showId: shows.id, episodeId: episodes.id, episodeTitle: episodes.title, episodeNumber: episodes.number, showTitle: shows.title,
  }).from(reviewCuts).innerJoin(episodes, eq(reviewCuts.episodeId, episodes.id)).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(reviewCuts.id, reviewCutId), eq(reviewCuts.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
  if (!cut) return null;
  const [notes, history] = await Promise.all([
    listReviewNotes(organizationId, reviewCutId),
    db.select({ id: reviewCuts.id, title: reviewCuts.title, version: reviewCuts.version, status: reviewCuts.status, approvalStatus: reviewCuts.approvalStatus, submittedAt: reviewCuts.submittedAt })
      .from(reviewCuts).where(and(eq(reviewCuts.organizationId, organizationId), eq(reviewCuts.episodeId, cut.episodeId))).orderBy(asc(reviewCuts.version)),
  ]);
  return { cut, notes, history };
}
