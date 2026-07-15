import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { postWorkOrders, qcIssues, qcReports } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { updateQcIssueSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ issueId: string }> }) {
  const parsed = updateQcIssueSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the QC issue." }, { status: 400 });
  const [mayManageQc, mayVerifyQc, mayWaiveQc] = await Promise.all([can("manage_qc"), can("verify_qc"), can("waive_qc")]);
  if (parsed.data.status === "open" && !mayManageQc) return NextResponse.json({ error: "Your role needs the Record QC reports permission to reopen a QC issue." }, { status: 403 });
  if (parsed.data.status === "waived" && !mayWaiveQc) return NextResponse.json({ error: "Your role needs the QC waiver permission." }, { status: 403 });
  if (parsed.data.status === "resolved" && !mayVerifyQc) return NextResponse.json({ error: "Your role needs the QC verification permission to resolve a QC issue." }, { status: 403 });
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
  if (parsed.data.status === "resolved") await db.update(postWorkOrders).set({ status: "complete", completedByPersonId: context.person?.id ?? null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.qcIssueId, issue.id)));
  if (parsed.data.status === "waived") await db.update(postWorkOrders).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.qcIssueId, issue.id)));
  if (parsed.data.status === "open") await db.update(postWorkOrders).set({ status: "open", completedByPersonId: null, completedAt: null, updatedAt: new Date() }).where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.qcIssueId, issue.id)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: `qc.issue_${parsed.data.status}`, entityType: "qc_issue", entityId: issue.id, metadata: { episodeId: issue.episodeId, qcReportId: issue.qcReportId } });
  return NextResponse.json(updated);
}
