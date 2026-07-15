import { and, eq, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { episodes, people, postWorkOrders, qcIssues, qcReports, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { insertQcReportSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_qc"))) return NextResponse.json({ error: "Your role needs the Record QC reports permission." }, { status: 403 });
  const parsed = insertQcReportSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the QC report details and waiver reason." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-qc-report", debug: true, status: parsed.data.status }, { status: 201 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const [episode] = await db.select({ id: episodes.id, workflowStageId: episodes.workflowStageId, editorId: episodes.editorId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1);
  if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const [actor] = await db.select({ id: people.id, role: people.role }).from(people)
    .where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1);
  if (parsed.data.status === "waived" && !(await can("waive_qc"))) return NextResponse.json({ error: "Your role needs the QC waiver permission." }, { status: 403 });
  if (parsed.data.status === "passed" && !(await can("verify_qc"))) return NextResponse.json({ error: "Your role needs the QC verification permission to record a passed result." }, { status: 403 });
  if (parsed.data.status === "passed") {
    const [openIssues, openExceptions] = await Promise.all([
      db.select({ id: qcIssues.id }).from(qcIssues).innerJoin(qcReports, eq(qcIssues.qcReportId, qcReports.id)).where(and(eq(qcIssues.organizationId, context.organization.organizationId), eq(qcReports.organizationId, context.organization.organizationId), eq(qcReports.episodeId, episode.id), eq(qcIssues.status, "open"))).limit(1),
      db.select({ id: postWorkOrders.id }).from(postWorkOrders).where(and(eq(postWorkOrders.organizationId, context.organization.organizationId), eq(postWorkOrders.episodeId, episode.id), eq(postWorkOrders.kind, "qc_exception"), notInArray(postWorkOrders.status, ["complete", "cancelled"]))).limit(1),
    ]);
    if (openIssues.length || openExceptions.length) return NextResponse.json({ error: "Resolve or waive every open QC issue and correction work order before recording a passed re-QC result." }, { status: 409 });
  }
  const qcStatus = parsed.data.status === "passed" ? "passed" : parsed.data.status === "waived" ? "waived" : parsed.data.status === "failed" ? "needs_attention" : "in_progress";
  const [report] = await db.insert(qcReports).values({
    ...parsed.data,
    organizationId: context.organization.organizationId,
    waivedByPersonId: parsed.data.status === "waived" ? actor?.id ?? null : null,
    completedAt: ["passed", "failed", "waived"].includes(parsed.data.status) ? new Date() : null,
  }).returning({ id: qcReports.id });
  if (parsed.data.status === "failed") {
    await db.insert(postWorkOrders).values({
      organizationId: context.organization.organizationId,
      episodeId: episode.id,
      workflowStageId: episode.workflowStageId,
      kind: "qc_exception",
      title: "QC failure — assign and resolve corrections",
      description: parsed.data.summary ?? "A QC report has failed. Review the external report and log each correction before re-QC.",
      department: "QC",
      assigneePersonId: episode.editorId,
      priority: "blocker",
      isBlocking: true,
      externalUrl: parsed.data.reportUrl ?? null,
      createdByUserId: context.userId,
    });
  }
  await db.update(episodes).set({ qcStatus, updatedAt: new Date() }).where(eq(episodes.id, episode.id));
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: `qc.${parsed.data.status}`, entityType: "qc_report", entityId: report.id, metadata: { episodeId: episode.id } });
  return NextResponse.json({ ...report, qcStatus }, { status: 201 });
}
