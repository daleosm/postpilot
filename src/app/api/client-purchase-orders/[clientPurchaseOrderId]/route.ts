import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { can } from "@/lib/permissions";
import { ClientPurchaseOrderError, updateActiveClientPurchaseOrder } from "@/server/client-purchase-orders";
import { getActiveClientPurchaseOrderDetail } from "@/server/data/client-purchase-orders";

export async function GET(_request: Request, { params }: { params: Promise<{ clientPurchaseOrderId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { clientPurchaseOrderId } = await params;
  const order = await getActiveClientPurchaseOrderDetail(clientPurchaseOrderId);
  if (!order) return NextResponse.json({ error: "Client purchase order not found." }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ clientPurchaseOrderId: string }> }) {
  const { clientPurchaseOrderId } = await params;
  try {
    return NextResponse.json(await updateActiveClientPurchaseOrder(clientPurchaseOrderId, await request.json()));
  } catch (error) {
    if (error instanceof ClientPurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "client_purchase_order_update_failed", error, "Unable to update the client purchase order.");
  }
}
