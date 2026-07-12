import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { episodes, people, qcReports, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { insertQcReportSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_reviews")) && !(await can("manage_shows"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertQcReportSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the QC report details and waiver reason." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-qc-report", debug: true, status: parsed.data.status }, { status: 201 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const [episode] = await db.select({ id: episodes.id }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, context.organization.organizationId), eq(seasons.organizationId, context.organization.organizationId), eq(shows.organizationId, context.organization.organizationId))).limit(1);
  if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  const [actor] = await db.select({ id: people.id, role: people.role }).from(people)
    .where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1);
  const isManager = ["owner", "admin"].includes(context.organization.role) || ["producer", "post_supervisor"].includes(actor?.role ?? "");
  if (parsed.data.status === "waived" && !isManager) return NextResponse.json({ error: "Only a post supervisor or producer can waive QC." }, { status: 403 });
  const qcStatus = parsed.data.status === "passed" ? "passed" : parsed.data.status === "waived" ? "waived" : parsed.data.status === "failed" ? "needs_attention" : "in_progress";
  const [report] = await db.insert(qcReports).values({
    ...parsed.data,
    organizationId: context.organization.organizationId,
    waivedByPersonId: parsed.data.status === "waived" ? actor?.id ?? null : null,
    completedAt: ["passed", "failed", "waived"].includes(parsed.data.status) ? new Date() : null,
  }).returning({ id: qcReports.id });
  await db.update(episodes).set({ qcStatus, updatedAt: new Date() }).where(eq(episodes.id, episode.id));
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: `qc.${parsed.data.status}`, entityType: "qc_report", entityId: report.id, metadata: { episodeId: episode.id } });
  return NextResponse.json({ ...report, qcStatus }, { status: 201 });
}
