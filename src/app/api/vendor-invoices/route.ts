import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { budgetLines, crmCompanies, episodes, postWorkOrders, seasons, shows, vendorInvoices } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { insertVendorInvoiceSchema } from "@/lib/validations/entities";

/** Record supplier invoices separately from client billables, and put their actual value into the episode cost ledger. */
export async function POST(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = insertVendorInvoiceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the vendor invoice." }, { status: 400 });
  const context = await getActiveOrganizationContext(); if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId; const db = getDb();
  const [[vendor], [episode], [workOrder]] = await Promise.all([
    db.select({ id: crmCompanies.id, type: crmCompanies.type }).from(crmCompanies).where(and(eq(crmCompanies.id, parsed.data.vendorCompanyId), eq(crmCompanies.organizationId, organizationId))).limit(1),
    db.select({ id: episodes.id, showId: shows.id, seasonId: seasons.id }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, parsed.data.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1),
    parsed.data.workOrderId ? db.select({ id: postWorkOrders.id, episodeId: postWorkOrders.episodeId, status: postWorkOrders.status }).from(postWorkOrders).where(and(eq(postWorkOrders.id, parsed.data.workOrderId), eq(postWorkOrders.organizationId, organizationId))).limit(1) : Promise.resolve([]),
  ]);
  if (!vendor || vendor.type !== "vendor") return NextResponse.json({ error: "Select a vendor in this post house." }, { status: 400 });
  if (!episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  if (parsed.data.workOrderId && (!workOrder || workOrder.episodeId !== episode.id)) return NextResponse.json({ error: "Work order not found for this episode." }, { status: 404 });
  if (workOrder?.status === "open") return NextResponse.json({ error: "Approve the vendor work order before recording its invoice." }, { status: 409 });
  const [invoice] = await db.insert(vendorInvoices).values({ organizationId, vendorCompanyId: parsed.data.vendorCompanyId, workOrderId: parsed.data.workOrderId ?? null, showId: episode.showId, episodeId: episode.id, invoiceNumber: parsed.data.invoiceNumber, description: parsed.data.description ?? null, amount: String(parsed.data.amount), currency: context.organization.currency, status: parsed.data.status, invoiceDate: parsed.data.invoiceDate ? parsed.data.invoiceDate.toISOString().slice(0, 10) : null, dueDate: parsed.data.dueDate ? parsed.data.dueDate.toISOString().slice(0, 10) : null }).returning({ id: vendorInvoices.id });
  const [line] = await db.insert(budgetLines).values({ organizationId, showId: episode.showId, seasonId: episode.seasonId, episodeId: episode.id, vendorInvoiceId: invoice.id, category: "Vendor invoice", description: `${vendor.type} invoice ${parsed.data.invoiceNumber}${parsed.data.description ? ` · ${parsed.data.description}` : ""}`, budgetedAmount: "0", actualAmount: String(parsed.data.amount), currency: context.organization.currency, costType: "internal" }).returning({ id: budgetLines.id });
  if (workOrder) await db.update(postWorkOrders).set({ actualAmount: String(parsed.data.amount), updatedAt: new Date() }).where(and(eq(postWorkOrders.id, workOrder.id), eq(postWorkOrders.organizationId, organizationId)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "vendor_invoice.recorded", entityType: "vendor_invoice", entityId: invoice.id, metadata: { budgetLineId: line.id } });
  return NextResponse.json(invoice, { status: 201 });
}
