import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { episodes, postWorkOrders, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { getTenantPurchaseOrder } from "@/lib/purchase-orders";
import { createPostWorkOrderSchema } from "@/lib/validations/entities";

export async function POST(request: Request) {
  if (!(await can("manage_work_orders"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const payload = await request.json();
  const parsed = createPostWorkOrderSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the work-order details." }, { status: 400 });
  if (!(await can("manage_budget")) && ["estimatedAmount", "currency", "billingNotes"].some((field) => field in payload)) return NextResponse.json({ error: "Only users with the Budget permission can set commercial values." }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const missing = await missingTenantReferences(organizationId, { episodeId: parsed.data.episodeId, workflowStageId: parsed.data.workflowStageId, bookingId: parsed.data.bookingId, personId: parsed.data.assigneePersonId, companyId: parsed.data.vendorCompanyId });
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this post house.` }, { status: 404 });
  const [episode] = await getDb().select({ showId: shows.id }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
  if (!episode) return NextResponse.json({ error: "Episode not found for this post house." }, { status: 404 });
  let vendorCompanyId = parsed.data.vendorCompanyId;
  if (parsed.data.purchaseOrderId) {
    const po = await getTenantPurchaseOrder(organizationId, parsed.data.purchaseOrderId);
    if (!po) return NextResponse.json({ error: "Invalid purchase order for this post house." }, { status: 404 });
    const expectedKind = parsed.data.billingScope === "billable_change" ? "client_authorisation" : "vendor_commitment";
    if (po.kind !== expectedKind) return NextResponse.json({ error: expectedKind === "vendor_commitment" ? "Select a vendor PO for this work order." : "Select a client authorisation PO for this client change." }, { status: 400 });
    if (po.episodeId && po.episodeId !== parsed.data.episodeId) return NextResponse.json({ error: "This PO is allocated to a different episode." }, { status: 400 });
    if (po.showId && po.showId !== episode.showId) return NextResponse.json({ error: "This PO belongs to a different show." }, { status: 400 });
    if (po.kind === "vendor_commitment") { if (parsed.data.vendorCompanyId && parsed.data.vendorCompanyId !== po.companyId) return NextResponse.json({ error: "The selected vendor does not match this PO." }, { status: 400 }); vendorCompanyId = po.companyId; }
  }
  const { estimatedAmount, ...workOrderData } = parsed.data;
  const [workOrder] = await getDb().insert(postWorkOrders).values({
    ...workOrderData,
    vendorCompanyId,
    estimatedAmount: estimatedAmount === undefined || estimatedAmount === null ? estimatedAmount : String(estimatedAmount),
    organizationId,
    billingStatus: parsed.data.billingScope === "billable_change" ? "draft" : "not_billable",
    createdByUserId: context.userId,
  }).returning({ id: postWorkOrders.id });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "work_order.created", entityType: "post_work_order", entityId: workOrder.id, metadata: { episodeId: parsed.data.episodeId, kind: parsed.data.kind, priority: parsed.data.priority, billingScope: parsed.data.billingScope } });
  return NextResponse.json(workOrder, { status: 201 });
}
