import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { qcIssues, qcReports } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { updateQcIssueSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ issueId: string }> }) {
  if (!(await can("manage_qc"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateQcIssueSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the QC issue." }, { status: 400 });
  if (parsed.data.status === "waived" && !(await can("waive_qc"))) return NextResponse.json({ error: "Your role needs the QC waiver permission." }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { issueId } = await params;
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [issue] = await db.select({ id: qcIssues.id, qcReportId: qcIssues.qcReportId, episodeId: qcReports.episodeId }).from(qcIssues)
    .innerJoin(qcReports, eq(qcIssues.qcReportId, qcReports.id))
    .where(and(eq(qcIssues.id, issueId), eq(qcIssues.organizationId, organizationId), eq(qcReports.organizationId, organizationId))).limit(1);
  if (!issue) return NextResponse.json({ error: "QC issue not found." }, { status: 404 });

  const [updated] = await db.update(qcIssues).set({ status: parsed.data.status, resolution: parsed.data.resolution ?? null, resolvedAt: parsed.data.status === "open" ? null : new Date(), updatedAt: new Date() })
    .where(and(eq(qcIssues.id, issue.id), eq(qcIssues.organizationId, organizationId))).returning({ id: qcIssues.id, status: qcIssues.status, resolution: qcIssues.resolution, resolvedAt: qcIssues.resolvedAt });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: `qc.issue_${parsed.data.status}`, entityType: "qc_issue", entityId: issue.id, metadata: { episodeId: issue.episodeId, qcReportId: issue.qcReportId } });
  return NextResponse.json(updated);
}
