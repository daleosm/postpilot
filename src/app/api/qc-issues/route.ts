import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { episodes, postWorkOrders, qcIssues, qcReports } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { insertQcIssueSchema } from "@/lib/validations/entities";
import { getEpisodeWorkflowState } from "@/server/data/episode-workflow-state";

export async function POST(request: Request) {
  if (!(await can("manage_qc"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertQcIssueSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the QC issue." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [report] = await db.select({ id: qcReports.id, episodeId: qcReports.episodeId, editorId: episodes.editorId }).from(qcReports)
    .innerJoin(episodes, eq(qcReports.episodeId, episodes.id))
    .where(and(eq(qcReports.id, parsed.data.qcReportId), eq(qcReports.organizationId, organizationId), eq(episodes.organizationId, organizationId))).limit(1);
  if (!report) return NextResponse.json({ error: "QC report not found." }, { status: 404 });
  const workflowState = await getEpisodeWorkflowState(organizationId, report.episodeId);

  const [issue] = await db.insert(qcIssues).values({ ...parsed.data, timecodeSeconds: parsed.data.timecodeSeconds?.toString() ?? null, organizationId }).returning({ id: qcIssues.id, status: qcIssues.status, code: qcIssues.code, severity: qcIssues.severity, description: qcIssues.description, timecodeSeconds: qcIssues.timecodeSeconds, resolution: qcIssues.resolution, resolvedAt: qcIssues.resolvedAt });
  await db.insert(postWorkOrders).values({
    organizationId,
    episodeId: report.episodeId,
    workflowStageId: workflowState.primaryStageId,
    qcIssueId: issue.id,
    kind: "qc_exception",
    status: "in_progress",
    title: `QC ${issue.severity} — ${issue.code ?? "correction required"}`,
    description: issue.description,
    department: "QC",
    assigneePersonId: report.editorId,
    priority: issue.severity === "critical" ? "blocker" : issue.severity === "major" ? "high" : "normal",
    isBlocking: true,
    createdByUserId: context.userId,
  });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "qc.issue_created", entityType: "qc_issue", entityId: issue.id, metadata: { episodeId: report.episodeId, qcReportId: report.id, severity: issue.severity } });
  return NextResponse.json({ ...issue, qcReportId: report.id }, { status: 201 });
}
