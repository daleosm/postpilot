import { NextResponse } from "next/server";

import { can } from "@/lib/permissions";
import { getActivePurchaseOrderDetail } from "@/server/data/purchase-orders";
import { PurchaseOrderError, updateActivePurchaseOrder } from "@/server/purchase-orders";

export async function GET(_request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { purchaseOrderId } = await params;
  const order = await getActivePurchaseOrderDetail(purchaseOrderId);
  if (!order) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  const { purchaseOrderId } = await params;
  try {
    return NextResponse.json(await updateActivePurchaseOrder(purchaseOrderId, await request.json()));
  } catch (error) {
    if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to update the purchase order." }, { status: 500 });
  }
}
