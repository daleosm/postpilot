import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { activityLog, crmCompanies, episodes, purchaseOrderAllocations, purchaseOrders, seasons, shows, users, vendorInvoices } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";

type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;

export type PurchaseOrderBalances = {
  authorisedAmount: number;
  committedAmount: number;
  actualInvoicedAmount: number;
  remainingAmount: number;
  varianceAmount: number;
};

export type PurchaseOrderSummary = Pick<PurchaseOrderRow, "id" | "vendorCompanyId" | "showId" | "episodeId" | "poNumber" | "currency" | "approvedAmount" | "issueDate" | "expiryDate" | "status" | "notes" | "externalDocumentUrl" | "createdAt" | "updatedAt"> & PurchaseOrderBalances & {
  vendorName: string | null;
  showTitle: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
};

const asAmount = (value: string | number | null) => Number(value ?? 0);

function balancesFor(order: Pick<PurchaseOrderRow, "approvedAmount">, totals: { committed: string | number | null; actualInvoiced: string | number | null }): PurchaseOrderBalances {
  const authorisedAmount = asAmount(order.approvedAmount);
  const committedAmount = asAmount(totals.committed);
  const actualInvoicedAmount = asAmount(totals.actualInvoiced);
  return {
    authorisedAmount,
    committedAmount,
    actualInvoicedAmount,
    remainingAmount: authorisedAmount - committedAmount,
    varianceAmount: actualInvoicedAmount - authorisedAmount,
  };
}

async function allocationTotalsByPurchaseOrder(organizationId: string, purchaseOrderIds: string[]) {
  if (!purchaseOrderIds.length) return new Map<string, { committed: string | number | null; actualInvoiced: string | number | null }>();
  const rows = await getDb().select({
    purchaseOrderId: purchaseOrderAllocations.purchaseOrderId,
    committed: sql<string>`coalesce(sum(case when ${purchaseOrderAllocations.allocationType} in ('work_order', 'budget_line') then ${purchaseOrderAllocations.amount} else 0 end), 0)`,
    actualInvoiced: sql<string>`coalesce(sum(case when ${purchaseOrderAllocations.allocationType} = 'vendor_invoice' then ${purchaseOrderAllocations.amount} else 0 end), 0)`,
  }).from(purchaseOrderAllocations)
    .where(and(eq(purchaseOrderAllocations.organizationId, organizationId), inArray(purchaseOrderAllocations.purchaseOrderId, purchaseOrderIds)))
    .groupBy(purchaseOrderAllocations.purchaseOrderId);
  return new Map(rows.map((row) => [row.purchaseOrderId, row]));
}

/** Internal organisation-scoped query; callers must derive organisationId from active membership. */
export async function listPurchaseOrdersForOrganization(organizationId: string): Promise<PurchaseOrderSummary[]> {
  const orders = await getDb().select({
    id: purchaseOrders.id, vendorCompanyId: purchaseOrders.vendorCompanyId, showId: purchaseOrders.showId, episodeId: purchaseOrders.episodeId,
    poNumber: purchaseOrders.poNumber, currency: purchaseOrders.currency, approvedAmount: purchaseOrders.approvedAmount, issueDate: purchaseOrders.issueDate,
    expiryDate: purchaseOrders.expiryDate, status: purchaseOrders.status, notes: purchaseOrders.notes, externalDocumentUrl: purchaseOrders.externalDocumentUrl,
    createdAt: purchaseOrders.createdAt, updatedAt: purchaseOrders.updatedAt, vendorName: crmCompanies.name, showTitle: shows.title,
    episodeNumber: episodes.number, episodeTitle: episodes.title,
  }).from(purchaseOrders)
    .leftJoin(crmCompanies, and(eq(purchaseOrders.vendorCompanyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
    .leftJoin(shows, and(eq(purchaseOrders.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(purchaseOrders.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .where(eq(purchaseOrders.organizationId, organizationId))
    .orderBy(desc(purchaseOrders.createdAt));
  const totals = await allocationTotalsByPurchaseOrder(organizationId, orders.map((order) => order.id));
  return orders.map((order) => ({ ...order, ...balancesFor(order, totals.get(order.id) ?? { committed: 0, actualInvoiced: 0 }) }));
}

/** Internal organisation-scoped query; returns null for a foreign or missing PO. */
export async function getPurchaseOrderDetailForOrganization(organizationId: string, purchaseOrderId: string) {
  const [order] = await getDb().select({
    id: purchaseOrders.id, vendorCompanyId: purchaseOrders.vendorCompanyId, showId: purchaseOrders.showId, episodeId: purchaseOrders.episodeId,
    poNumber: purchaseOrders.poNumber, currency: purchaseOrders.currency, approvedAmount: purchaseOrders.approvedAmount, issueDate: purchaseOrders.issueDate,
    expiryDate: purchaseOrders.expiryDate, status: purchaseOrders.status, notes: purchaseOrders.notes, externalDocumentUrl: purchaseOrders.externalDocumentUrl,
    createdAt: purchaseOrders.createdAt, updatedAt: purchaseOrders.updatedAt, vendorName: crmCompanies.name, showTitle: shows.title,
    episodeNumber: episodes.number, episodeTitle: episodes.title,
  }).from(purchaseOrders)
    .leftJoin(crmCompanies, and(eq(purchaseOrders.vendorCompanyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
    .leftJoin(shows, and(eq(purchaseOrders.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(purchaseOrders.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, organizationId))).limit(1);
  if (!order) return null;
  const [totals, allocations, activity] = await Promise.all([
    allocationTotalsByPurchaseOrder(organizationId, [purchaseOrderId]),
    getDb().select({
      id: purchaseOrderAllocations.id,
      organizationId: purchaseOrderAllocations.organizationId,
      purchaseOrderId: purchaseOrderAllocations.purchaseOrderId,
      allocationType: purchaseOrderAllocations.allocationType,
      workOrderId: purchaseOrderAllocations.workOrderId,
      budgetLineId: purchaseOrderAllocations.budgetLineId,
      vendorInvoiceId: purchaseOrderAllocations.vendorInvoiceId,
      amount: purchaseOrderAllocations.amount,
      allocationDate: purchaseOrderAllocations.allocationDate,
      reference: purchaseOrderAllocations.reference,
      description: purchaseOrderAllocations.description,
      createdByUserId: purchaseOrderAllocations.createdByUserId,
      createdAt: purchaseOrderAllocations.createdAt,
      updatedAt: purchaseOrderAllocations.updatedAt,
      externalDocumentUrl: vendorInvoices.externalDocumentUrl,
    }).from(purchaseOrderAllocations)
      .leftJoin(vendorInvoices, and(eq(purchaseOrderAllocations.vendorInvoiceId, vendorInvoices.id), eq(vendorInvoices.organizationId, organizationId)))
      .where(and(eq(purchaseOrderAllocations.organizationId, organizationId), eq(purchaseOrderAllocations.purchaseOrderId, purchaseOrderId)))
      .orderBy(desc(purchaseOrderAllocations.allocationDate), desc(purchaseOrderAllocations.createdAt)),
    getDb().select({ id: activityLog.id, action: activityLog.action, metadata: activityLog.metadata, createdAt: activityLog.createdAt, actorName: users.name })
      .from(activityLog).leftJoin(users, eq(activityLog.actorUserId, users.id))
      .where(and(eq(activityLog.organizationId, organizationId), eq(activityLog.entityType, "purchase_order"), eq(activityLog.entityId, purchaseOrderId)))
      .orderBy(desc(activityLog.createdAt)).limit(30),
  ]);
  return { ...order, ...balancesFor(order, totals.get(order.id) ?? { committed: 0, actualInvoiced: 0 }), allocations, activity };
}

/** Active-tenant data entry point for future server components. */
export async function listActivePurchaseOrders() {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return [];
  return listPurchaseOrdersForOrganization(context.organization.organizationId);
}

/** Active-tenant data entry point for future server components. */
export async function getActivePurchaseOrderDetail(purchaseOrderId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return null;
  return getPurchaseOrderDetailForOrganization(context.organization.organizationId, purchaseOrderId);
}

/** Server-filtered selector for external vendor work on one specific episode. */
export async function listEligiblePurchaseOrdersForWorkOrder(organizationId: string, vendorCompanyId: string, episodeId: string) {
  const [episode] = await getDb().select({ showId: shows.id }).from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
  if (!episode) return [];
  const orders = await listPurchaseOrdersForOrganization(organizationId);
  return orders.filter((order) => order.status === "approved" && order.vendorCompanyId === vendorCompanyId && (!order.showId || order.showId === episode.showId) && (!order.episodeId || order.episodeId === episodeId));
}
