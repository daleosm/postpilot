import "server-only";

import { aliasedTable, and, asc, desc, eq, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { activityLog, crmCompanies, episodeTeamAssignments, episodeWorkflowApprovals, episodeWorkflowTracks, episodes, people, postWorkflows, qcIssues, qcReports, seasons, shows, workflowStageApprovalRules, workflowStages } from "@/lib/db/schema";
import { getBudgetData } from "./budget";
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
  const [schedule, budget, activity, stages, approvalRules, approvals, workflowTracks, workflowApprovers, workOrders, episodeTeam, qcHistory, qcIssueHistory, vendorOptions] = await Promise.all([
    listSchedule(organizationId, new Date(Date.now() - 90 * 86_400_000), new Date(Date.now() + 120 * 86_400_000)),
    getBudgetData(organizationId),
    db.select({ id: activityLog.id, action: activityLog.action, entityType: activityLog.entityType, entityId: activityLog.entityId, metadata: activityLog.metadata, createdAt: activityLog.createdAt })
      .from(activityLog)
      .where(and(eq(activityLog.organizationId, organizationId), or(eq(activityLog.entityId, episodeId), sql`${activityLog.metadata}->>'episodeId' = ${episodeId}`)))
      .orderBy(desc(activityLog.createdAt)).limit(30),
    db.select({ id: workflowStages.id, name: workflowStages.name, key: workflowStages.key, position: workflowStages.position, canStartEarly: workflowStages.canStartEarly })
      .from(workflowStages).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(eq(postWorkflows.organizationId, organizationId), eq(workflowStages.organizationId, organizationId), eq(postWorkflows.isDefault, true))).orderBy(asc(workflowStages.position)),
    db.select({ id: workflowStageApprovalRules.id, workflowStageId: workflowStageApprovalRules.workflowStageId, approverRole: workflowStageApprovalRules.approverRole, label: workflowStageApprovalRules.label, approvalOrder: workflowStageApprovalRules.approvalOrder, isRequired: workflowStageApprovalRules.isRequired })
      .from(workflowStageApprovalRules).innerJoin(workflowStages, eq(workflowStageApprovalRules.workflowStageId, workflowStages.id)).innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(eq(postWorkflows.organizationId, organizationId), eq(workflowStages.organizationId, organizationId), eq(workflowStageApprovalRules.organizationId, organizationId), eq(postWorkflows.isDefault, true))).orderBy(asc(workflowStageApprovalRules.approvalOrder)),
    db.select({ id: episodeWorkflowApprovals.id, workflowStageId: episodeWorkflowApprovals.workflowStageId, approvalRuleId: episodeWorkflowApprovals.approvalRuleId, approverRole: episodeWorkflowApprovals.approverRole, requiredPersonId: episodeWorkflowApprovals.requiredPersonId, status: episodeWorkflowApprovals.status, comment: episodeWorkflowApprovals.comment, submittedAt: episodeWorkflowApprovals.submittedAt, respondedAt: episodeWorkflowApprovals.respondedAt })
      .from(episodeWorkflowApprovals).where(and(eq(episodeWorkflowApprovals.organizationId, organizationId), eq(episodeWorkflowApprovals.episodeId, episodeId))),
    db.select({ id: episodeWorkflowTracks.id, workflowStageId: episodeWorkflowTracks.workflowStageId, status: episodeWorkflowTracks.status, startedAt: episodeWorkflowTracks.startedAt, completedAt: episodeWorkflowTracks.completedAt, blockedReason: episodeWorkflowTracks.blockedReason })
      .from(episodeWorkflowTracks).where(and(eq(episodeWorkflowTracks.organizationId, organizationId), eq(episodeWorkflowTracks.episodeId, episodeId))),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(eq(people.organizationId, organizationId)).orderBy(asc(people.name)),
    listEpisodeWorkOrders(organizationId, episodeId),
    db.select({ id: episodeTeamAssignments.id, personId: people.id, name: people.name, role: people.role, isLead: episodeTeamAssignments.isLead }).from(episodeTeamAssignments).innerJoin(people, eq(episodeTeamAssignments.personId, people.id)).where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodeTeamAssignments.episodeId, episodeId), eq(people.organizationId, organizationId))),
    db.select({ id: qcReports.id, status: qcReports.status, reportUrl: qcReports.reportUrl, summary: qcReports.summary, waiverReason: qcReports.waiverReason, completedAt: qcReports.completedAt, createdAt: qcReports.createdAt }).from(qcReports).where(and(eq(qcReports.organizationId, organizationId), eq(qcReports.episodeId, episodeId))).orderBy(desc(qcReports.createdAt)),
    db.select({ id: qcIssues.id, qcReportId: qcIssues.qcReportId, code: qcIssues.code, severity: qcIssues.severity, description: qcIssues.description, timecodeSeconds: qcIssues.timecodeSeconds, status: qcIssues.status, resolution: qcIssues.resolution, resolvedAt: qcIssues.resolvedAt, createdAt: qcIssues.createdAt }).from(qcIssues)
      .innerJoin(qcReports, eq(qcIssues.qcReportId, qcReports.id))
      .where(and(eq(qcIssues.organizationId, organizationId), eq(qcReports.organizationId, organizationId), eq(qcReports.episodeId, episodeId))).orderBy(desc(qcIssues.createdAt)),
    db.select({ id: crmCompanies.id, name: crmCompanies.name }).from(crmCompanies).where(and(eq(crmCompanies.organizationId, organizationId), eq(crmCompanies.type, "vendor"))).orderBy(asc(crmCompanies.name)),
  ]);

  return {
    episode,
    schedule: schedule.filter((booking) => booking.episodeId === episode.id),
    budget: budget.lines.filter((line) => line.episodeId === episode.id),
    activity,
    workflowStages: stages,
    workflowApprovalRules: approvalRules,
    workflowApprovals: approvals,
    workflowTracks,
    workflowApprovers,
    workOrders,
    episodeTeam,
    qcHistory,
    qcIssueHistory,
    vendorOptions,
  };
}
