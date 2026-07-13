import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { crmCompanies, episodes, purchaseOrders, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";

const schema = z.object({ companyId: z.string().uuid(), showId: z.string().uuid().nullable(), episodeId: z.string().uuid().nullable(), poNumber: z.string().trim().min(1).max(120), kind: z.enum(["vendor_commitment", "client_authorisation"]), approvedAmount: z.coerce.number().positive(), currency: z.string().trim().length(3), expiresAt: z.string().date().nullable(), status: z.enum(["open", "on_hold", "closed", "cancelled"]), notes: z.string().trim().max(2000).nullable() });

export async function POST(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the purchase-order details." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId; const db = getDb();
  const [company, episode] = await Promise.all([
    db.select({ id: crmCompanies.id, type: crmCompanies.type }).from(crmCompanies).where(and(eq(crmCompanies.id, parsed.data.companyId), eq(crmCompanies.organizationId, organizationId))).limit(1),
    parsed.data.episodeId ? db.select({ id: episodes.id, showId: shows.id }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1) : Promise.resolve([]),
  ]);
  if (!company[0]) return NextResponse.json({ error: "Company not found for this post house." }, { status: 404 });
  if (parsed.data.kind === "vendor_commitment" && company[0].type !== "vendor") return NextResponse.json({ error: "A vendor commitment must be assigned to a vendor company." }, { status: 400 });
  if (parsed.data.kind === "client_authorisation" && company[0].type === "vendor") return NextResponse.json({ error: "A client authorisation must be assigned to a client, network, studio, or production company." }, { status: 400 });
  if (parsed.data.episodeId && !episode[0]) return NextResponse.json({ error: "Episode not found for this post house." }, { status: 404 });
  if (parsed.data.showId && episode[0] && parsed.data.showId !== episode[0].showId) return NextResponse.json({ error: "The selected episode is not part of this show." }, { status: 400 });
  if (parsed.data.showId) { const [show] = await db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, parsed.data.showId), eq(shows.organizationId, organizationId))).limit(1); if (!show) return NextResponse.json({ error: "Show not found for this post house." }, { status: 404 }); }
  const [po] = await db.insert(purchaseOrders).values({ organizationId, companyId: parsed.data.companyId, showId: parsed.data.showId ?? episode[0]?.showId ?? null, episodeId: parsed.data.episodeId, poNumber: parsed.data.poNumber, kind: parsed.data.kind, amount: String(parsed.data.approvedAmount), currency: parsed.data.currency.toUpperCase(), expiresAt: parsed.data.expiresAt, status: parsed.data.status, notes: parsed.data.notes }).returning({ id: purchaseOrders.id });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "purchase_order.created", entityType: "purchase_order", entityId: po.id, metadata: { poNumber: parsed.data.poNumber, kind: parsed.data.kind, approvedAmount: parsed.data.approvedAmount } });
  return NextResponse.json(po, { status: 201 });
}
