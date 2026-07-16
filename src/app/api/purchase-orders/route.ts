import { NextResponse } from "next/server";
import { z } from "zod";

import { PurchaseOrderError, createActivePurchaseOrder } from "@/server/purchase-orders";
import { listActivePurchaseOrders, listEligiblePurchaseOrdersForWorkOrder } from "@/server/data/purchase-orders";
import { can } from "@/lib/permissions";
import { getActiveOrganizationContext } from "@/lib/organizations";

const optionsQuerySchema = z.object({ vendorId: z.string().uuid(), episodeId: z.string().uuid() });

/** PO reads and drafts are always resolved from the active tenant on the server. */
export async function GET(request: Request) {
  const query = optionsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (query.success) {
    if (!(await can("manage_work_orders")) && !(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const context = await getActiveOrganizationContext();
    if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await listEligiblePurchaseOrdersForWorkOrder(context.organization.organizationId, query.data.vendorId, query.data.episodeId));
  }
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await listActivePurchaseOrders());
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createActivePurchaseOrder(await request.json()), { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to create the purchase order." }, { status: 500 });
  }
}
