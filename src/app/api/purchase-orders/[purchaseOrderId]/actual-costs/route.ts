import { NextResponse } from "next/server";

import { PurchaseOrderError, recordActivePurchaseOrderActualCost } from "@/server/purchase-orders";

export async function POST(request: Request, { params }: { params: Promise<{ purchaseOrderId: string }> }) {
  const { purchaseOrderId } = await params;
  try {
    return NextResponse.json(await recordActivePurchaseOrderActualCost(purchaseOrderId, await request.json()), { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to record the supplier actual cost." }, { status: 500 });
  }
}
