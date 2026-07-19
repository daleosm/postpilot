import "server-only";

import { and, desc, eq, notInArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { postWorkOrders, qcIssues, qcReports } from "@/lib/db/schema";

/** A configured QC decision stage only opens after its latest QC result is clear. */
export async function getQcGateReadiness(organizationId: string, episodeId: string) {
  const db = getDb();
  const [[latestReport], [openIssue], [openException]] = await Promise.all([
    db.select({ status: qcReports.status }).from(qcReports)
      .where(and(eq(qcReports.organizationId, organizationId), eq(qcReports.episodeId, episodeId)))
      .orderBy(desc(qcReports.createdAt)).limit(1),
    db.select({ id: qcIssues.id }).from(qcIssues).innerJoin(qcReports, eq(qcIssues.qcReportId, qcReports.id))
      .where(and(eq(qcIssues.organizationId, organizationId), eq(qcReports.organizationId, organizationId), eq(qcReports.episodeId, episodeId), eq(qcIssues.status, "open"))).limit(1),
    db.select({ id: postWorkOrders.id }).from(postWorkOrders)
      .where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.episodeId, episodeId), eq(postWorkOrders.kind, "qc_exception"), notInArray(postWorkOrders.status, ["complete", "cancelled"]))).limit(1),
  ]);
  const clearedReport = latestReport?.status === "passed" || latestReport?.status === "waived";
  return { ready: clearedReport && !openIssue && !openException, latestStatus: latestReport?.status ?? null };
}

export const qcGateBlockedMessage = "QC must pass or be waived, and all QC corrections must be closed, before this stage can be signed off.";
