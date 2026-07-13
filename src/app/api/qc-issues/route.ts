import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { qcIssues, qcReports } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { insertQcIssueSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_qc"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertQcIssueSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the QC issue." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [report] = await db.select({ id: qcReports.id, episodeId: qcReports.episodeId }).from(qcReports)
    .where(and(eq(qcReports.id, parsed.data.qcReportId), eq(qcReports.organizationId, organizationId))).limit(1);
  if (!report) return NextResponse.json({ error: "QC report not found." }, { status: 404 });

  const [issue] = await db.insert(qcIssues).values({ ...parsed.data, timecodeSeconds: parsed.data.timecodeSeconds?.toString() ?? null, organizationId }).returning({ id: qcIssues.id, status: qcIssues.status, code: qcIssues.code, severity: qcIssues.severity, description: qcIssues.description, timecodeSeconds: qcIssues.timecodeSeconds, resolution: qcIssues.resolution, resolvedAt: qcIssues.resolvedAt });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "qc.issue_created", entityType: "qc_issue", entityId: issue.id, metadata: { episodeId: report.episodeId, qcReportId: report.id, severity: issue.severity } });
  return NextResponse.json({ ...issue, qcReportId: report.id }, { status: 201 });
}
