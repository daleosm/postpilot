import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { postWorkOrders } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { createPostWorkOrderSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_work_orders"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = createPostWorkOrderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the work-order details." }, { status: 400 });
  if (isDebugDemoMode) return NextResponse.json({ id: "demo-work-order", debug: true }, { status: 201 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const missing = await missingTenantReferences(organizationId, { episodeId: parsed.data.episodeId, workflowStageId: parsed.data.workflowStageId, bookingId: parsed.data.bookingId, personId: parsed.data.assigneePersonId });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this post house.` }, { status: 404 });
  const { estimatedAmount, ...workOrderData } = parsed.data;
  const [workOrder] = await getDb().insert(postWorkOrders).values({
    ...workOrderData,
    estimatedAmount: estimatedAmount === undefined || estimatedAmount === null ? estimatedAmount : String(estimatedAmount),
    organizationId,
    billingStatus: parsed.data.billingScope === "billable_change" ? "draft" : "not_billable",
    createdByUserId: context.userId,
  }).returning({ id: postWorkOrders.id });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "work_order.created", entityType: "post_work_order", entityId: workOrder.id, metadata: { episodeId: parsed.data.episodeId, kind: parsed.data.kind, priority: parsed.data.priority, billingScope: parsed.data.billingScope } });
  return NextResponse.json(workOrder, { status: 201 });
}
