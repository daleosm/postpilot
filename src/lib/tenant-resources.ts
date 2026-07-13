import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  bookings,
  budgetLines,
  crmCompanies,
  crmContacts,
  episodes,
  people,
  qcIssues,
  qcReports,
  rooms,
  seasons,
  shows,
  workflowStageApprovalRules,
  workflowStages,
} from "@/lib/db/schema";

type TenantReferences = Partial<{
  showId: string | null;
  seasonId: string | null;
  episodeId: string | null;
  personId: string | null;
  roomId: string | null;
  bookingId: string | null;
  budgetLineId: string | null;
  workflowStageId: string | null;
  workflowRuleId: string | null;
  qcReportId: string | null;
  qcIssueId: string | null;
  companyId: string | null;
  contactId: string | null;
}>;

/** Validates client-supplied resource IDs against the active tenant before a mutation. */
export async function missingTenantReferences(organizationId: string, references: TenantReferences) {
  const db = getDb();
  const checks = [
    references.showId ? ["show", db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, references.showId), eq(shows.organizationId, organizationId))).limit(1)] as const : null,
    references.seasonId ? ["season", db.select({ id: seasons.id }).from(seasons).where(and(eq(seasons.id, references.seasonId), eq(seasons.organizationId, organizationId))).limit(1)] as const : null,
    references.episodeId ? ["episode", db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.id, references.episodeId), eq(episodes.organizationId, organizationId))).limit(1)] as const : null,
    references.personId ? ["person", db.select({ id: people.id }).from(people).where(and(eq(people.id, references.personId), eq(people.organizationId, organizationId))).limit(1)] as const : null,
    references.roomId ? ["room", db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, references.roomId), eq(rooms.organizationId, organizationId))).limit(1)] as const : null,
    references.bookingId ? ["booking", db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.id, references.bookingId), eq(bookings.organizationId, organizationId))).limit(1)] as const : null,
    references.budgetLineId ? ["budget line", db.select({ id: budgetLines.id }).from(budgetLines).where(and(eq(budgetLines.id, references.budgetLineId), eq(budgetLines.organizationId, organizationId))).limit(1)] as const : null,
    references.workflowStageId ? ["workflow stage", db.select({ id: workflowStages.id }).from(workflowStages).where(and(eq(workflowStages.id, references.workflowStageId), eq(workflowStages.organizationId, organizationId))).limit(1)] as const : null,
    references.workflowRuleId ? ["workflow approval rule", db.select({ id: workflowStageApprovalRules.id }).from(workflowStageApprovalRules).where(and(eq(workflowStageApprovalRules.id, references.workflowRuleId), eq(workflowStageApprovalRules.organizationId, organizationId))).limit(1)] as const : null,
    references.qcReportId ? ["QC report", db.select({ id: qcReports.id }).from(qcReports).where(and(eq(qcReports.id, references.qcReportId), eq(qcReports.organizationId, organizationId))).limit(1)] as const : null,
    references.qcIssueId ? ["QC issue", db.select({ id: qcIssues.id }).from(qcIssues).where(and(eq(qcIssues.id, references.qcIssueId), eq(qcIssues.organizationId, organizationId))).limit(1)] as const : null,
    references.companyId ? ["company", db.select({ id: crmCompanies.id }).from(crmCompanies).where(and(eq(crmCompanies.id, references.companyId), eq(crmCompanies.organizationId, organizationId))).limit(1)] as const : null,
    references.contactId ? ["contact", db.select({ id: crmContacts.id }).from(crmContacts).where(and(eq(crmContacts.id, references.contactId), eq(crmContacts.organizationId, organizationId))).limit(1)] as const : null,
  ].filter((check): check is NonNullable<typeof check> => Boolean(check));

  const results = await Promise.all(checks.map(async ([label, query]) => ({ label, found: (await query).length > 0 })));
  return results.filter((result) => !result.found).map((result) => result.label);
}
