import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { deliveryRequirements } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { updateDeliveryRequirementProgressSchema } from "@/lib/validations/entities";

export async function PATCH(request: Request, { params }: { params: Promise<{ requirementId: string }> }) {
  if (!(await can("manage_deliverables"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateDeliveryRequirementProgressSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the requirement update." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ ok: true, debug: true });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { requirementId } = await params;
  const [requirement] = await getDb().update(deliveryRequirements).set({ isComplete: parsed.data.isComplete, evidenceUrl: parsed.data.evidenceUrl, checksum: parsed.data.checksum, completedAt: parsed.data.isComplete ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(deliveryRequirements.id, requirementId), eq(deliveryRequirements.organizationId, context.organization.organizationId))).returning({ id: deliveryRequirements.id });
  if (!requirement) return NextResponse.json({ error: "Requirement not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
