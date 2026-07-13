import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { purchaseOrders } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { reconcilePurchaseOrder } from "@/lib/purchase-orders";

const schema = z.object({ poNumber: z.string().trim().min(1).max(120).optional(), approvedAmount: z.coerce.number().positive().optional(), expiresAt: z.string().date().nullable().optional(), status: z.enum(["open", "on_hold", "closed", "cancelled"]).optional(), notes: z.string().trim().max(2000).nullable().optional() }).refine((value) => Object.keys(value).length > 0);
export async function PATCH(request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Check the purchase-order update." }, { status: 400 });
  const context = await getActiveOrganizationContext(); if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { purchaseOrderId } = await params; const organizationId = context.organization.organizationId;
  const current = await reconcilePurchaseOrder(organizationId, purchaseOrderId); if (!current) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
  if (parsed.data.approvedAmount !== undefined && parsed.data.approvedAmount < Number(current.consumedAmount) && !(await can("approve_po_overruns"))) return NextResponse.json({ error: "Approved amount cannot be lower than consumed value without PO-overrun approval." }, { status: 409 });
  await getDb().update(purchaseOrders).set({ poNumber: parsed.data.poNumber, amount: parsed.data.approvedAmount === undefined ? undefined : String(parsed.data.approvedAmount), expiresAt: parsed.data.expiresAt, status: parsed.data.status, notes: parsed.data.notes, updatedAt: new Date() }).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, organizationId)));
  await reconcilePurchaseOrder(organizationId, purchaseOrderId, { actorUserId: context.userId, action: "purchase_order.updated", metadata: { fields: Object.keys(parsed.data) } });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "purchase_order.updated", entityType: "purchase_order", entityId: purchaseOrderId, metadata: { fields: Object.keys(parsed.data) } });
  return NextResponse.json({ ok: true });
}
