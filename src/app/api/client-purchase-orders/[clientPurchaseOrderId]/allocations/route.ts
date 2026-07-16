import { NextResponse } from "next/server";

import { ClientPurchaseOrderError, createActiveClientPurchaseOrderAllocation } from "@/server/client-purchase-orders";

export async function POST(request: Request, { params }: { params: Promise<{ clientPurchaseOrderId: string }> }) {
  const { clientPurchaseOrderId } = await params;
  try {
    return NextResponse.json(await createActiveClientPurchaseOrderAllocation(clientPurchaseOrderId, await request.json()), { status: 201 });
  } catch (error) {
    if (error instanceof ClientPurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to allocate the client purchase order." }, { status: 500 });
  }
}
