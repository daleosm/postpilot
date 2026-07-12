import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { cateringRequests, people } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { updateCateringRequestSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  if (!(await can("manage_catering"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateCateringRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid fulfilment status." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ ok: true, debug: true, status: parsed.data.status });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { requestId } = await params;
  const db = getDb();
  const [[cateringRequest], [runner]] = await Promise.all([
    db.select({ id: cateringRequests.id }).from(cateringRequests).where(and(eq(cateringRequests.id, requestId), eq(cateringRequests.organizationId, context.organization.organizationId))).limit(1),
    db.select({ id: people.id }).from(people).where(and(eq(people.organizationId, context.organization.organizationId), eq(people.userId, context.userId))).limit(1),
  ]);
  if (!cateringRequest) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  await db.update(cateringRequests).set({ status: parsed.data.status, fulfilledByPersonId: runner?.id ?? null, fulfilledAt: parsed.data.status === "delivered" ? new Date() : null, updatedAt: new Date() }).where(and(eq(cateringRequests.id, requestId), eq(cateringRequests.organizationId, context.organization.organizationId)));
  await writeAuditEvent({ organizationId: context.organization.organizationId, actorUserId: context.userId, action: `catering.${parsed.data.status}`, entityType: "catering_request", entityId: requestId });
  return NextResponse.json({ ok: true, status: parsed.data.status });
}
