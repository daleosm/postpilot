import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { PurchaseOrderError, createActivePurchaseOrderAllocation } from "@/server/purchase-orders";

export async function POST(request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  const { purchaseOrderId } = await params;
  try {
    return NextResponse.json(await createActivePurchaseOrderAllocation(purchaseOrderId, await request.json()), { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "purchase_order_allocation_failed", error, "Unable to allocate the purchase order.");
  }
}
