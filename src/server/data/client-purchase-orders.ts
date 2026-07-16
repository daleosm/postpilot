import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { activityLog, billables, clientInvoiceItems, clientInvoices, clientPurchaseOrderAllocations, clientPurchaseOrders, crmCompanies, episodes, shows, users } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";

type ClientPurchaseOrderRow = typeof clientPurchaseOrders.$inferSelect;

export type ClientPurchaseOrderBalances = {
  authorisedAmount: number;
  committedToBillAmount: number;
  invoicedAmount: number;
  remainingAmount: number;
  varianceAmount: number;
};

export type ClientPurchaseOrderSummary = Pick<ClientPurchaseOrderRow, "id" | "clientCompanyId" | "showId" | "episodeId" | "poNumber" | "currency" | "approvedAmount" | "issueDate" | "expiryDate" | "status" | "notes" | "externalDocumentUrl" | "createdAt" | "updatedAt"> & ClientPurchaseOrderBalances & {
  clientName: string | null;
  showTitle: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
};

export type ClientPurchaseOrderCommercialLinks = {
  billablesByPurchaseOrder: Record<string, Array<{ id: string; description: string | null; reference: string | null; amount: number; currency: string; status: string }>>;
  invoicesByPurchaseOrder: Record<string, Array<{ id: string; invoiceNumber: string; invoiceDate: string; status: string; totalAmount: number; currency: string }>>;
};

const asAmount = (value: string | number | null) => Number(value ?? 0);

function balancesFor(order: Pick<ClientPurchaseOrderRow, "approvedAmount">, totals: { committed: string | number | null; invoiced: string | number | null }): ClientPurchaseOrderBalances {
  const authorisedAmount = asAmount(order.approvedAmount);
  const committedToBillAmount = asAmount(totals.committed);
  const invoicedAmount = asAmount(totals.invoiced);
  return {
    authorisedAmount,
    committedToBillAmount,
    invoicedAmount,
    remainingAmount: authorisedAmount - committedToBillAmount,
    varianceAmount: invoicedAmount - authorisedAmount,
  };
}

async function allocationTotalsByClientPurchaseOrder(organizationId: string, purchaseOrderIds: string[]) {
  if (!purchaseOrderIds.length) return new Map<string, { committed: string | number | null; invoiced: string | number | null }>();
  const rows = await getDb().select({
    clientPurchaseOrderId: clientPurchaseOrderAllocations.clientPurchaseOrderId,
    committed: sql<string>`coalesce(sum(case
      when ${clientPurchaseOrderAllocations.allocationType} = 'change_order' then ${clientPurchaseOrderAllocations.amount}
      when ${clientPurchaseOrderAllocations.allocationType} = 'billable' and exists (
        select 1 from "billables" as "client_po_billable_source" where "client_po_billable_source"."id" = "client_purchase_order_allocations"."billable_id"
        and "client_po_billable_source"."organization_id" = ${organizationId} and "client_po_billable_source"."status" in ('approved', 'invoiced', 'paid')
      ) then ${clientPurchaseOrderAllocations.amount}
      else 0 end), 0)`,
    invoiced: sql<string>`coalesce(sum(case
      when ${clientPurchaseOrderAllocations.allocationType} = 'client_invoice' and exists (
        select 1 from "client_invoices" as "client_po_invoice_source" where "client_po_invoice_source"."id" = "client_purchase_order_allocations"."client_invoice_id"
        and "client_po_invoice_source"."organization_id" = ${organizationId} and "client_po_invoice_source"."status" in ('issued', 'paid')
      ) then ${clientPurchaseOrderAllocations.amount}
      when ${clientPurchaseOrderAllocations.allocationType} = 'client_invoice' and exists (
        select 1 from "client_invoice_items" as "client_po_invoice_item_source"
        inner join "client_invoices" as "client_po_invoice_item_invoice_source" on "client_po_invoice_item_invoice_source"."id" = "client_po_invoice_item_source"."client_invoice_id"
        where "client_po_invoice_item_source"."id" = "client_purchase_order_allocations"."client_invoice_item_id"
        and "client_po_invoice_item_source"."organization_id" = ${organizationId} and "client_po_invoice_item_invoice_source"."organization_id" = ${organizationId}
        and "client_po_invoice_item_invoice_source"."status" in ('issued', 'paid')
      ) then ${clientPurchaseOrderAllocations.amount}
      else 0 end), 0)`,
  }).from(clientPurchaseOrderAllocations)
    .where(and(eq(clientPurchaseOrderAllocations.organizationId, organizationId), inArray(clientPurchaseOrderAllocations.clientPurchaseOrderId, purchaseOrderIds)))
    .groupBy(clientPurchaseOrderAllocations.clientPurchaseOrderId);
  return new Map(rows.map((row) => [row.clientPurchaseOrderId, row]));
}

/** Internal organisation-scoped query; callers must derive organisationId from active membership. */
export async function listClientPurchaseOrdersForOrganization(organizationId: string): Promise<ClientPurchaseOrderSummary[]> {
  const orders = await getDb().select({
    id: clientPurchaseOrders.id, clientCompanyId: clientPurchaseOrders.clientCompanyId, showId: clientPurchaseOrders.showId, episodeId: clientPurchaseOrders.episodeId,
    poNumber: clientPurchaseOrders.poNumber, currency: clientPurchaseOrders.currency, approvedAmount: clientPurchaseOrders.approvedAmount, issueDate: clientPurchaseOrders.issueDate,
    expiryDate: clientPurchaseOrders.expiryDate, status: clientPurchaseOrders.status, notes: clientPurchaseOrders.notes, externalDocumentUrl: clientPurchaseOrders.externalDocumentUrl,
    createdAt: clientPurchaseOrders.createdAt, updatedAt: clientPurchaseOrders.updatedAt, clientName: crmCompanies.name, showTitle: shows.title,
    episodeNumber: episodes.number, episodeTitle: episodes.title,
  }).from(clientPurchaseOrders)
    .leftJoin(crmCompanies, and(eq(clientPurchaseOrders.clientCompanyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
    .leftJoin(shows, and(eq(clientPurchaseOrders.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(clientPurchaseOrders.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .where(eq(clientPurchaseOrders.organizationId, organizationId))
    .orderBy(desc(clientPurchaseOrders.createdAt));
  const totals = await allocationTotalsByClientPurchaseOrder(organizationId, orders.map((order) => order.id));
  return orders.map((order) => ({ ...order, ...balancesFor(order, totals.get(order.id) ?? { committed: 0, invoiced: 0 }) }));
}

/** Client billing authorisations for a CRM account. Vendor POs use a separate data path. */
export async function listClientPurchaseOrdersForAccount(organizationId: string, clientCompanyId: string) {
  const orders = await listClientPurchaseOrdersForOrganization(organizationId);
  return orders.filter((order) => order.clientCompanyId === clientCompanyId && ["active", "closed"].includes(order.status));
}

/** Client billing authorisations tied to a show, including episode-specific POs. */
export async function listClientPurchaseOrdersForShow(organizationId: string, showId: string) {
  const orders = await listClientPurchaseOrdersForOrganization(organizationId);
  return orders.filter((order) => order.showId === showId && ["active", "closed"].includes(order.status));
}

/**
 * Resolves the commercial sources displayed alongside client PO balances.
 * Every query carries the tenant boundary; callers may safely pass only PO IDs
 * obtained from an organisation-scoped PO list.
 */
export async function getClientPurchaseOrderCommercialLinksForOrganization(organizationId: string, purchaseOrderIds: string[]): Promise<ClientPurchaseOrderCommercialLinks> {
  const empty: ClientPurchaseOrderCommercialLinks = { billablesByPurchaseOrder: {}, invoicesByPurchaseOrder: {} };
  if (!purchaseOrderIds.length) return empty;
  const db = getDb();
  const [directBillables, allocatedBillables, directInvoiceItems, allocatedInvoiceItems, allocatedInvoices] = await Promise.all([
    db.select({
      purchaseOrderId: billables.clientPurchaseOrderId,
      id: billables.id, description: billables.description, reference: billables.reference, amount: billables.amount, currency: billables.currency, status: billables.status,
    }).from(billables).where(and(eq(billables.organizationId, organizationId), inArray(billables.clientPurchaseOrderId, purchaseOrderIds))),
    db.select({
      purchaseOrderId: clientPurchaseOrderAllocations.clientPurchaseOrderId,
      id: billables.id, description: billables.description, reference: billables.reference, amount: billables.amount, currency: billables.currency, status: billables.status,
    }).from(clientPurchaseOrderAllocations)
      .innerJoin(billables, and(eq(clientPurchaseOrderAllocations.billableId, billables.id), eq(billables.organizationId, organizationId)))
      .where(and(eq(clientPurchaseOrderAllocations.organizationId, organizationId), inArray(clientPurchaseOrderAllocations.clientPurchaseOrderId, purchaseOrderIds))),
    db.select({
      purchaseOrderId: clientInvoiceItems.clientPurchaseOrderId,
      id: clientInvoices.id, invoiceNumber: clientInvoices.invoiceNumber, invoiceDate: clientInvoices.invoiceDate, status: clientInvoices.status, totalAmount: clientInvoices.totalAmount, currency: clientInvoices.currency,
    }).from(clientInvoiceItems)
      .innerJoin(clientInvoices, and(eq(clientInvoiceItems.clientInvoiceId, clientInvoices.id), eq(clientInvoices.organizationId, organizationId)))
      .where(and(eq(clientInvoiceItems.organizationId, organizationId), inArray(clientInvoiceItems.clientPurchaseOrderId, purchaseOrderIds))),
    db.select({
      purchaseOrderId: clientPurchaseOrderAllocations.clientPurchaseOrderId,
      id: clientInvoices.id, invoiceNumber: clientInvoices.invoiceNumber, invoiceDate: clientInvoices.invoiceDate, status: clientInvoices.status, totalAmount: clientInvoices.totalAmount, currency: clientInvoices.currency,
    }).from(clientPurchaseOrderAllocations)
      .innerJoin(clientInvoiceItems, and(eq(clientPurchaseOrderAllocations.clientInvoiceItemId, clientInvoiceItems.id), eq(clientInvoiceItems.organizationId, organizationId)))
      .innerJoin(clientInvoices, and(eq(clientInvoiceItems.clientInvoiceId, clientInvoices.id), eq(clientInvoices.organizationId, organizationId)))
      .where(and(eq(clientPurchaseOrderAllocations.organizationId, organizationId), inArray(clientPurchaseOrderAllocations.clientPurchaseOrderId, purchaseOrderIds))),
    db.select({
      purchaseOrderId: clientPurchaseOrderAllocations.clientPurchaseOrderId,
      id: clientInvoices.id, invoiceNumber: clientInvoices.invoiceNumber, invoiceDate: clientInvoices.invoiceDate, status: clientInvoices.status, totalAmount: clientInvoices.totalAmount, currency: clientInvoices.currency,
    }).from(clientPurchaseOrderAllocations)
      .innerJoin(clientInvoices, and(eq(clientPurchaseOrderAllocations.clientInvoiceId, clientInvoices.id), eq(clientInvoices.organizationId, organizationId)))
      .where(and(eq(clientPurchaseOrderAllocations.organizationId, organizationId), inArray(clientPurchaseOrderAllocations.clientPurchaseOrderId, purchaseOrderIds))),
  ]);

  const billablesByPurchaseOrder = new Map<string, Map<string, ClientPurchaseOrderCommercialLinks["billablesByPurchaseOrder"][string][number]>>();
  for (const row of [...directBillables, ...allocatedBillables]) {
    if (!row.purchaseOrderId) continue;
    const entries = billablesByPurchaseOrder.get(row.purchaseOrderId) ?? new Map();
    entries.set(row.id, { ...row, amount: asAmount(row.amount) });
    billablesByPurchaseOrder.set(row.purchaseOrderId, entries);
  }
  const invoicesByPurchaseOrder = new Map<string, Map<string, ClientPurchaseOrderCommercialLinks["invoicesByPurchaseOrder"][string][number]>>();
  for (const row of [...directInvoiceItems, ...allocatedInvoiceItems, ...allocatedInvoices]) {
    if (!row.purchaseOrderId) continue;
    const entries = invoicesByPurchaseOrder.get(row.purchaseOrderId) ?? new Map();
    entries.set(row.id, { ...row, totalAmount: asAmount(row.totalAmount) });
    invoicesByPurchaseOrder.set(row.purchaseOrderId, entries);
  }
  return {
    billablesByPurchaseOrder: Object.fromEntries([...billablesByPurchaseOrder].map(([purchaseOrderId, entries]) => [purchaseOrderId, [...entries.values()]])),
    invoicesByPurchaseOrder: Object.fromEntries([...invoicesByPurchaseOrder].map(([purchaseOrderId, entries]) => [purchaseOrderId, [...entries.values()]])),
  };
}

/** Internal organisation-scoped query; returns null for a foreign or missing client PO. */
export async function getClientPurchaseOrderDetailForOrganization(organizationId: string, purchaseOrderId: string) {
  const [order] = await getDb().select({
    id: clientPurchaseOrders.id, clientCompanyId: clientPurchaseOrders.clientCompanyId, showId: clientPurchaseOrders.showId, episodeId: clientPurchaseOrders.episodeId,
    poNumber: clientPurchaseOrders.poNumber, currency: clientPurchaseOrders.currency, approvedAmount: clientPurchaseOrders.approvedAmount, issueDate: clientPurchaseOrders.issueDate,
    expiryDate: clientPurchaseOrders.expiryDate, status: clientPurchaseOrders.status, notes: clientPurchaseOrders.notes, externalDocumentUrl: clientPurchaseOrders.externalDocumentUrl,
    createdAt: clientPurchaseOrders.createdAt, updatedAt: clientPurchaseOrders.updatedAt, clientName: crmCompanies.name, showTitle: shows.title,
    episodeNumber: episodes.number, episodeTitle: episodes.title,
  }).from(clientPurchaseOrders)
    .leftJoin(crmCompanies, and(eq(clientPurchaseOrders.clientCompanyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
    .leftJoin(shows, and(eq(clientPurchaseOrders.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(clientPurchaseOrders.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .where(and(eq(clientPurchaseOrders.id, purchaseOrderId), eq(clientPurchaseOrders.organizationId, organizationId))).limit(1);
  if (!order) return null;
  const [totals, allocations, activity] = await Promise.all([
    allocationTotalsByClientPurchaseOrder(organizationId, [purchaseOrderId]),
    getDb().select({
      id: clientPurchaseOrderAllocations.id, organizationId: clientPurchaseOrderAllocations.organizationId, clientPurchaseOrderId: clientPurchaseOrderAllocations.clientPurchaseOrderId,
      allocationType: clientPurchaseOrderAllocations.allocationType, billableId: clientPurchaseOrderAllocations.billableId, clientInvoiceId: clientPurchaseOrderAllocations.clientInvoiceId, clientInvoiceItemId: clientPurchaseOrderAllocations.clientInvoiceItemId,
      changeOrderReference: clientPurchaseOrderAllocations.changeOrderReference, amount: clientPurchaseOrderAllocations.amount, overrunAuthorised: clientPurchaseOrderAllocations.overrunAuthorised, allocationDate: clientPurchaseOrderAllocations.allocationDate,
      reference: clientPurchaseOrderAllocations.reference, description: clientPurchaseOrderAllocations.description, createdByUserId: clientPurchaseOrderAllocations.createdByUserId,
      createdAt: clientPurchaseOrderAllocations.createdAt, updatedAt: clientPurchaseOrderAllocations.updatedAt,
    }).from(clientPurchaseOrderAllocations)
      .where(and(eq(clientPurchaseOrderAllocations.organizationId, organizationId), eq(clientPurchaseOrderAllocations.clientPurchaseOrderId, purchaseOrderId)))
      .orderBy(desc(clientPurchaseOrderAllocations.allocationDate), desc(clientPurchaseOrderAllocations.createdAt)),
    getDb().select({ id: activityLog.id, action: activityLog.action, metadata: activityLog.metadata, createdAt: activityLog.createdAt, actorName: users.name })
      .from(activityLog).leftJoin(users, eq(activityLog.actorUserId, users.id))
      .where(and(eq(activityLog.organizationId, organizationId), eq(activityLog.entityType, "client_purchase_order"), eq(activityLog.entityId, purchaseOrderId)))
      .orderBy(desc(activityLog.createdAt)).limit(30),
  ]);
  return { ...order, ...balancesFor(order, totals.get(order.id) ?? { committed: 0, invoiced: 0 }), allocations, activity };
}

/** Active-tenant entry point for server components and route handlers. */
export async function listActiveClientPurchaseOrders() {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return [];
  return listClientPurchaseOrdersForOrganization(context.organization.organizationId);
}

/** Active-tenant entry point; never discloses a foreign client PO. */
export async function getActiveClientPurchaseOrderDetail(purchaseOrderId: string) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return null;
  return getClientPurchaseOrderDetailForOrganization(context.organization.organizationId, purchaseOrderId);
}

/**
 * Client POs usable for a specific billable. Scope values must come from a
 * server-owned show/episode record, never a browser-provided organisation ID.
 */
export async function listApplicableClientPurchaseOrdersForBilling(organizationId: string, scope: { clientCompanyId: string | null; showId: string; episodeId: string }) {
  if (!scope.clientCompanyId) return [];
  const orders = await listClientPurchaseOrdersForOrganization(organizationId);
  const today = new Date().toISOString().slice(0, 10);
  return orders.filter((order) => order.status === "active"
    && order.clientCompanyId === scope.clientCompanyId
    && (!order.showId || order.showId === scope.showId)
    && (!order.episodeId || order.episodeId === scope.episodeId)
    && (!order.expiryDate || order.expiryDate >= today));
}
