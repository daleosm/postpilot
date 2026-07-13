import "server-only";

import { aliasedTable, and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodeTeamAssignments, episodeWorkflowApprovals, episodes, people, postWorkflows, qcReports, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { getBudgetData } from "./budget";
import { getDashboardData } from "./dashboard";
import { listSchedule } from "./schedule";
import { listEpisodeWorkOrders } from "./work-orders";

const editors = aliasedTable(people, "episode_editors");
const producers = aliasedTable(people, "episode_producers");

export async function listEpisodes(organizationId: string, showId?: string) {
  const db = getDb();
  const conditions = [eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId)];
  if (showId) conditions.push(eq(shows.id, showId));

  return db.select({
    id: episodes.id, title: episodes.title, number: episodes.number, productionCode: episodes.productionCode, status: episodes.status, qcStatus: episodes.qcStatus, airDate: episodes.airDate, lockedCutDate: episodes.lockedCutDate, deliveryDeadline: episodes.deliveryDeadline,
    showId: shows.id, showTitle: shows.title, seasonNumber: seasons.number, workflowStageId: episodes.workflowStageId, workflowStage: workflowStages.name, workflowStageColor: workflowStages.color, editorName: editors.name, producerName: producers.name,
  }).from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .leftJoin(workflowStages, and(eq(episodes.workflowStageId, workflowStages.id), eq(workflowStages.organizationId, organizationId)))
    .leftJoin(editors, and(eq(episodes.editorId, editors.id), eq(editors.organizationId, organizationId)))
    .leftJoin(producers, and(eq(episodes.assignedProducerId, producers.id), eq(producers.organizationId, organizationId)))
    .where(and(...conditions)).orderBy(asc(shows.title), asc(seasons.number), asc(episodes.number));
}

export async function getEpisode(organizationId: string, episodeId: string) {
  const rows = await listEpisodes(organizationId);
  return rows.find((episode) => episode.id === episodeId) ?? null;
}

export async function getEpisodeWorkspace(organizationId: string, episodeId: string) {
  const db = getDb();
  const episode = await getEpisode(organizationId, episodeId);
  if (!episode) return null;
  const [schedule, budget, dashboard, stages, approvalRules, approvals, workflowApprovers, workOrders, episodeTeam, qcHistory] = await Promise.all([
    listSchedule(organizationId, new Date(Date.now() - 90 * 86_400_000), new Date(Date.now() + 120 * 86_400_000)),
    getBudgetData(organizationId),
    getDashboardData(organizationId),
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key, position: workflowStages.position, canStartEarly: workflowStages.canStartEarly })
      .from(workflowStages).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(eq(postWorkflows.organizationId, organizationId), eq(workflowStages.organizationId, organizationId), eq(postWorkflows.isDefault, true))).orderBy(asc(workflowStages.position)),
    db.select({ id: workflowStageApprovalRules.id, workflowStageId: workflowStageApprovalRules.workflowStageId, approverRole: workflowStageApprovalRules.approverRole, label: workflowStageApprovalRules.label, approvalOrder: workflowStageApprovalRules.approvalOrder, isRequired: workflowStageApprovalRules.isRequired })
      .from(workflowStageApprovalRules).innerJoin(workflowStages, eq(workflowStageApprovalRules.workflowStageId, workflowStages.id)).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(eq(postWorkflows.organizationId, organizationId), eq(workflowStages.organizationId, organizationId), eq(workflowStageApprovalRules.organizationId, organizationId), eq(postWorkflows.isDefault, true))).orderBy(asc(workflowStageApprovalRules.approvalOrder)),
    db.select({ id: episodeWorkflowApprovals.id, workflowStageId: episodeWorkflowApprovals.workflowStageId, approvalRuleId: episodeWorkflowApprovals.approvalRuleId, approverRole: episodeWorkflowApprovals.approverRole, requiredPersonId: episodeWorkflowApprovals.requiredPersonId, status: episodeWorkflowApprovals.status, comment: episodeWorkflowApprovals.comment, submittedAt: episodeWorkflowApprovals.submittedAt, respondedAt: episodeWorkflowApprovals.respondedAt })
      .from(episodeWorkflowApprovals).where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), eq(episodeWorkflowApprovals.episodeId, episodeId))),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(eq(people.organizationId, organizationId)).orderBy(asc(people.name)),
    listEpisodeWorkOrders(organizationId, episodeId),
    db.select({ id: episodeTeamAssignments.id, personId: people.id, name: people.name, role: people.role, responsibility: episodeTeamAssignments.responsibility, isLead: episodeTeamAssignments.isLead }).from(episodeTeamAssignments).innerJoin(people, eq(episodeTeamAssignments.personId, people.id)).where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, organizationId))),
    db.select({ id: qcReports.id, status: qcReports.status, reportUrl: qcReports.reportUrl, summary: qcReports.summary, waiverReason: qcReports.waiverReason, completedAt: qcReports.completedAt, createdAt: qcReports.createdAt }).from(qcReports).where(and(eq(qcReports.organizationId, organizationId), eq(qcReports.episodeId, episodeId))).orderBy(desc(qcReports.createdAt)),
  ]);

  return {
    episode,
    schedule: schedule.filter((booking) => booking.episodeTitle === episode.title && booking.episodeNumber === episode.number),
    budget: budget.lines.filter((line) => line.showTitle === episode.showTitle),
    activity: dashboard.activity,
    workflowStages: stages,
    workflowApprovalRules: approvalRules,
    workflowApprovals: approvals,
    workflowApprovers,
    workOrders,
    episodeTeam,
    qcHistory,
  };
}
