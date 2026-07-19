import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { billables, bookings, clientInvoiceItems, clientInvoices, clientPurchaseOrderAllocations, clientPurchaseOrders, crmCompanies, episodes, invoiceSettings, people, seasons, shows } from "@/lib/db/schema";
import { getEpisodeWorkflowState } from "./episode-workflow-state";

export type ClientPoBillingWarning = {
  clientPurchaseOrderId: string;
  poNumber: string;
  kind: "expired" | "expiring" | "exhausted" | "overrun_unapproved" | "missing_allocation" | "inactive";
  message: string;
  blocksBilling: boolean;
};

export type InvoiceReadiness = {
  episode: { id: string; title: string; number: number; productionCode: string | null; showId: string; showTitle: string; clientCompanyId: string | null; clientName: string | null; clientAddress: string | null; clientEmail: string | null; paymentTermsDays: number | null; workflowStageName: string | null; workflowComplete: boolean } | null;
  unconfirmedBookings: Array<{ id: string; title: string; personName: string | null }>;
  billables: Array<{ id: string; description: string | null; reference: string | null; amount: string; currency: string; clientPurchaseOrderId: string | null }>;
  invoices: Array<{ id: string; invoiceNumber: string; status: "issued" | "paid" | "void"; invoiceDate: string; dueDate: string; totalAmount: string; currency: string; exportBlockedReason: string | null }>;
  invoiceProfileComplete: boolean;
  clientPoWarnings: ClientPoBillingWarning[];
  readyToIssue: boolean;
  blockedReason: string | null;
};

type ClientPoSource = { id: string; clientPurchaseOrderId: string | null; amount: string | number };

/**
 * A selected Client PO is a required billing authority for that charge. A
 * charge without one remains explicitly optional and is not blocked. This
 * protects issued invoices without forcing a PO onto every client job.
 */
export async function getClientPoBillingWarnings(organizationId: string, sources: ClientPoSource[], options: { requireActive: boolean; asOf?: string } = { requireActive: true }): Promise<ClientPoBillingWarning[]> {
  const poIds = [...new Set(sources.map((source) => source.clientPurchaseOrderId).filter((id): id is string => Boolean(id)))];
  if (!poIds.length) return [];
  const db = getDb();
  const [orders, allocations] = await Promise.all([
    db.select({ id: clientPurchaseOrders.id, poNumber: clientPurchaseOrders.poNumber, approvedAmount: clientPurchaseOrders.approvedAmount, expiryDate: clientPurchaseOrders.expiryDate, status: clientPurchaseOrders.status })
      .from(clientPurchaseOrders).where(and(eq(clientPurchaseOrders.organizationId, organizationId), inArray(clientPurchaseOrders.id, poIds))),
    db.select({ clientPurchaseOrderId: clientPurchaseOrderAllocations.clientPurchaseOrderId, allocationType: clientPurchaseOrderAllocations.allocationType, billableId: clientPurchaseOrderAllocations.billableId, amount: clientPurchaseOrderAllocations.amount, overrunAuthorised: clientPurchaseOrderAllocations.overrunAuthorised })
      .from(clientPurchaseOrderAllocations).where(and(eq(clientPurchaseOrderAllocations.organizationId, organizationId), inArray(clientPurchaseOrderAllocations.clientPurchaseOrderId, poIds))),
  ]);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const today = options.asOf ?? new Date().toISOString().slice(0, 10);
  const warnings: ClientPoBillingWarning[] = [];
  for (const purchaseOrderId of poIds) {
    const order = orderById.get(purchaseOrderId);
    const sourceRows = sources.filter((source) => source.clientPurchaseOrderId === purchaseOrderId);
    if (!order) {
      warnings.push({ clientPurchaseOrderId: purchaseOrderId, poNumber: "Missing client PO", kind: "missing_allocation", message: "A required Client PO is no longer available in this post house.", blocksBilling: true });
      continue;
    }
    const orderAllocations = allocations.filter((allocation) => allocation.clientPurchaseOrderId === purchaseOrderId);
    const missingCoverage = sourceRows.some((source) => !orderAllocations.some((allocation) => allocation.allocationType === "billable" && allocation.billableId === source.id));
    if (missingCoverage) warnings.push({ clientPurchaseOrderId: order.id, poNumber: order.poNumber, kind: "missing_allocation", message: `${order.poNumber} is required for this charge, but its billable commitment is missing.`, blocksBilling: true });
    if (options.requireActive && order.status !== "active") warnings.push({ clientPurchaseOrderId: order.id, poNumber: order.poNumber, kind: "inactive", message: `${order.poNumber} is ${order.status} and cannot authorise a new invoice.`, blocksBilling: true });
    if (order.expiryDate && order.expiryDate < today) warnings.push({ clientPurchaseOrderId: order.id, poNumber: order.poNumber, kind: "expired", message: `${order.poNumber} expired on ${order.expiryDate}.`, blocksBilling: true });
    else if (order.expiryDate && order.status === "active") {
      const days = Math.ceil((new Date(`${order.expiryDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
      if (days <= 30) warnings.push({ clientPurchaseOrderId: order.id, poNumber: order.poNumber, kind: "expiring", message: `${order.poNumber} expires in ${days} day${days === 1 ? "" : "s"}.`, blocksBilling: false });
    }
    const committed = orderAllocations.filter((allocation) => allocation.allocationType === "billable" || allocation.allocationType === "change_order").reduce((sum, allocation) => sum + Number(allocation.amount), 0);
    const invoiced = orderAllocations.filter((allocation) => allocation.allocationType === "client_invoice").reduce((sum, allocation) => sum + Number(allocation.amount), 0);
    const authorised = Number(order.approvedAmount);
    if (committed >= authorised) warnings.push({ clientPurchaseOrderId: order.id, poNumber: order.poNumber, kind: "exhausted", message: `${order.poNumber} has no remaining uncommitted billing authority.`, blocksBilling: true });
    if (Math.max(committed, invoiced) > authorised && !orderAllocations.some((allocation) => allocation.overrunAuthorised)) warnings.push({ clientPurchaseOrderId: order.id, poNumber: order.poNumber, kind: "overrun_unapproved", message: `${order.poNumber} exceeds its authorised value without recorded overrun approval.`, blocksBilling: true });
  }
  return warnings;
}

/**
 * Invoice issuance is gated by actual time, not just planned bookings. That
 * keeps a client document from being created before all assigned staff have
 * confirmed their final hours for this episode.
 */
export async function getEpisodeInvoiceReadiness(organizationId: string, episodeId: string): Promise<InvoiceReadiness> {
  const db = getDb();
  const [episode] = await db.select({
    id: episodes.id,
    title: episodes.title,
    number: episodes.number,
    productionCode: episodes.productionCode,
    showId: shows.id,
    showTitle: shows.title,
    clientCompanyId: crmCompanies.id,
    clientName: crmCompanies.name,
    clientAddress: crmCompanies.address,
    clientEmail: crmCompanies.financeEmail,
    paymentTermsDays: crmCompanies.paymentTermsDays,
  }).from(episodes)
    .innerJoin(seasons, and(eq(episodes.seasonId, seasons.id), eq(seasons.organizationId, organizationId)))
    .innerJoin(shows, and(eq(seasons.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(crmCompanies, and(eq(shows.clientCompanyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
    .where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId))).limit(1);

  if (!episode) return { episode: null, unconfirmedBookings: [], billables: [], invoices: [], invoiceProfileComplete: false, clientPoWarnings: [], readyToIssue: false, blockedReason: "Episode not found." };
  const workflowState = await getEpisodeWorkflowState(organizationId, episodeId);
  const workflowComplete = workflowState.displayStatus === "complete";

  const [unconfirmedBookings, approvedBillables, issuedInvoices, issuedInvoiceItems, profileRows] = await Promise.all([
    db.select({ id: bookings.id, title: bookings.title, personName: people.name }).from(bookings)
      .leftJoin(people, and(eq(bookings.personId, people.id), eq(people.organizationId, organizationId)))
      .where(and(
        eq(bookings.organizationId, organizationId),
        eq(bookings.episodeId, episodeId),
        isNotNull(bookings.personId),
        ne(bookings.status, "cancelled"),
        or(isNull(bookings.actualStartsAt), isNull(bookings.actualEndsAt)),
      )).orderBy(asc(bookings.startsAt)),
    db.select({ id: billables.id, description: billables.description, reference: billables.reference, amount: billables.amount, currency: billables.currency, clientPurchaseOrderId: billables.clientPurchaseOrderId }).from(billables)
      .where(and(eq(billables.organizationId, organizationId), eq(billables.episodeId, episodeId), eq(billables.status, "approved"), isNull(billables.clientInvoiceId))).orderBy(asc(billables.createdAt)),
    db.select({ id: clientInvoices.id, invoiceNumber: clientInvoices.invoiceNumber, status: clientInvoices.status, invoiceDate: clientInvoices.invoiceDate, dueDate: clientInvoices.dueDate, totalAmount: clientInvoices.totalAmount, currency: clientInvoices.currency }).from(clientInvoices)
      .where(and(eq(clientInvoices.organizationId, organizationId), eq(clientInvoices.episodeId, episodeId))).orderBy(asc(clientInvoices.sequence)),
    db.select({ clientInvoiceId: clientInvoiceItems.clientInvoiceId, billableId: clientInvoiceItems.billableId, clientPurchaseOrderId: clientInvoiceItems.clientPurchaseOrderId, amount: clientInvoiceItems.amount }).from(clientInvoiceItems)
      .innerJoin(clientInvoices, and(eq(clientInvoiceItems.clientInvoiceId, clientInvoices.id), eq(clientInvoices.organizationId, organizationId)))
      .where(and(eq(clientInvoiceItems.organizationId, organizationId), eq(clientInvoices.episodeId, episodeId))),
    db.select({ legalName: invoiceSettings.legalName, legalAddress: invoiceSettings.legalAddress }).from(invoiceSettings).where(eq(invoiceSettings.organizationId, organizationId)).limit(1),
  ]);

  const clientPoWarnings = await getClientPoBillingWarnings(organizationId, approvedBillables, { requireActive: true });
  const invoicesWithExportSafeguards = await Promise.all(issuedInvoices.map(async (invoice) => {
    const warnings = await getClientPoBillingWarnings(organizationId, issuedInvoiceItems.filter((item) => item.clientInvoiceId === invoice.id).map((item) => ({ id: item.billableId ?? item.clientInvoiceId, clientPurchaseOrderId: item.clientPurchaseOrderId, amount: item.amount })), { requireActive: false });
    return { ...invoice, exportBlockedReason: warnings.find((warning) => warning.blocksBilling)?.message ?? null };
  }));
  const clientPoBlocked = clientPoWarnings.find((warning) => warning.blocksBilling);
  const clientMissing = !episode.clientCompanyId || !episode.clientName;
  const invoiceProfileComplete = Boolean(profileRows[0]?.legalName?.trim() && profileRows[0]?.legalAddress?.trim());
  const readyToIssue = invoiceProfileComplete && !clientMissing && workflowComplete && unconfirmedBookings.length === 0 && approvedBillables.length > 0 && !clientPoBlocked;
  const blockedReason = clientMissing
    ? "Assign a client or production company to the show before issuing an invoice."
    : !invoiceProfileComplete
      ? "Complete the invoicing profile with the legal entity name and registered address before issuing an invoice."
    : !workflowComplete
      ? `Complete the episode workflow before issuing an invoice${workflowState.primaryStageName ? ` (currently ${workflowState.primaryStageName})` : ""}.`
    : unconfirmedBookings.length
      ? `${unconfirmedBookings.length} assigned booking${unconfirmedBookings.length === 1 ? "" : "s"} still need actual time confirmed.`
      : approvedBillables.length === 0
        ? "No approved client charges are ready to invoice."
        : clientPoBlocked
          ? clientPoBlocked.message
        : null;

  return {
    episode: { ...episode, workflowStageName: workflowState.primaryStageName, workflowComplete },
    unconfirmedBookings,
    billables: approvedBillables,
    invoices: invoicesWithExportSafeguards,
    invoiceProfileComplete,
    clientPoWarnings,
    readyToIssue,
    blockedReason,
  };
}

export async function getInvoiceSettings(organizationId: string) {
  const [settings] = await getDb().select().from(invoiceSettings).where(eq(invoiceSettings.organizationId, organizationId)).limit(1);
  return settings ?? null;
}
