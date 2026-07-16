import { NextResponse } from "next/server";

import { ClientPurchaseOrderError, createActiveClientPurchaseOrder } from "@/server/client-purchase-orders";
import { listActiveClientPurchaseOrders } from "@/server/data/client-purchase-orders";
import { can } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { episodes, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { listApplicableClientPurchaseOrdersForBilling } from "@/server/data/client-purchase-orders";

export async function GET(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const episodeId = new URL(request.url).searchParams.get("episodeId");
  if (episodeId) {
    const context = await getActiveOrganizationContext();
    if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const organizationId = context.organization.organizationId;
    const [episode] = await getDb().select({ id: episodes.id, showId: shows.id, clientCompanyId: shows.clientCompanyId }).from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
    if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
    return NextResponse.json(await listApplicableClientPurchaseOrdersForBilling(organizationId, { clientCompanyId: episode.clientCompanyId, showId: episode.showId, episodeId: episode.id }));
  }
  return NextResponse.json(await listActiveClientPurchaseOrders());
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createActiveClientPurchaseOrder(await request.json()), { status: 201 });
  } catch (error) {
    if (error instanceof ClientPurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Unable to create the client purchase order." }, { status: 500 });
  }
}
