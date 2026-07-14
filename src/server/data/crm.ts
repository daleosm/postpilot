import "server-only";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activityLog, billables, budgetLines, crmCompanies, crmContacts, episodes, people, postWorkOrders, purchaseOrderEvents, purchaseOrders, rateCardItems, rateCards as rateCardRecords, seasons, shows, vendorInvoices } from "@/lib/db/schema";

export async function getCrmData(organizationId: string) {
  const db = getDb();
  const [companies, contacts, cards, invoiceRows, workOrders, showOptions, episodeOptions, showLinks, owners] = await Promise.all([
    db.select().from(crmCompanies).where(eq(crmCompanies.organizationId, organizationId)).orderBy(asc(crmCompanies.name)),
    db.select({ id: crmContacts.id, companyId: crmContacts.companyId, name: crmContacts.name, title: crmContacts.title, email: crmContacts.email, phone: crmContacts.phone, contactType: crmContacts.contactType, isPrimary: crmContacts.isPrimary, companyName: crmCompanies.name, companyType: crmCompanies.type }).from(crmContacts).innerJoin(crmCompanies, and(eq(crmContacts.companyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId))).where(eq(crmContacts.organizationId, organizationId)).orderBy(asc(crmContacts.name)),
    db.select({ id: rateCardRecords.id, name: rateCardRecords.name, currency: rateCardRecords.currency, showTitle: shows.title, companyName: crmCompanies.name, itemId: rateCardItems.id }).from(rateCardRecords).leftJoin(shows, eq(rateCardRecords.showId, shows.id)).leftJoin(crmCompanies, eq(rateCardRecords.clientCompanyId, crmCompanies.id)).leftJoin(rateCardItems, eq(rateCardItems.rateCardId, rateCardRecords.id)).where(eq(rateCardRecords.organizationId, organizationId)).orderBy(asc(rateCardRecords.name)),
    db.select({ id: vendorInvoices.id, vendorCompanyId: vendorInvoices.vendorCompanyId, invoiceNumber: vendorInvoices.invoiceNumber, amount: vendorInvoices.amount, currency: vendorInvoices.currency, status: vendorInvoices.status, dueDate: vendorInvoices.dueDate }).from(vendorInvoices).where(eq(vendorInvoices.organizationId, organizationId)).orderBy(desc(vendorInvoices.invoiceDate)),
    db.select({ id: postWorkOrders.id, vendorCompanyId: postWorkOrders.vendorCompanyId, title: postWorkOrders.title, status: postWorkOrders.status, dueAt: postWorkOrders.dueAt, episodeTitle: episodes.title, episodeNumber: episodes.number }).from(postWorkOrders).innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id)).where(and(eq(postWorkOrders.organizationId, organizationId), eq(episodes.organizationId, organizationId))).orderBy(asc(postWorkOrders.dueAt)),
    db.select({ id: shows.id, title: shows.title, code: shows.code }).from(shows).where(eq(shows.organizationId, organizationId)).orderBy(asc(shows.title)),
    db.select({ id: episodes.id, showId: shows.id, showTitle: shows.title, number: episodes.number, title: episodes.title }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).orderBy(asc(shows.title), asc(episodes.number)),
    db.select({ id: shows.id, clientCompanyId: shows.clientCompanyId, productionCompanyId: shows.productionCompanyId }).from(shows).where(eq(shows.organizationId, organizationId)),
    db.select({ id: people.id, name: people.name }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.isActive, true))).orderBy(asc(people.name)),
  ]);
  const rateCards = Object.values(cards.reduce<Record<string, { id: string; name: string; currency: string; showTitle: string | null; companyName: string | null; itemCount: number }>>((result, card) => { result[card.id] ??= { id: card.id, name: card.name, currency: card.currency, showTitle: card.showTitle, companyName: card.companyName, itemCount: 0 }; if (card.itemId) result[card.id].itemCount += 1; return result; }, {}));
  return { companies, contacts, rateCards, vendorInvoices: invoiceRows, workOrders, showOptions, episodeOptions, showLinks, owners };
}

export async function getPurchaseOrderDetail(organizationId: string, purchaseOrderId: string) {
  const db = getDb();
  const [purchaseOrder] = await db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, kind: purchaseOrders.kind, approvedAmount: purchaseOrders.amount, consumedAmount: purchaseOrders.consumedAmount, currency: purchaseOrders.currency, expiresAt: purchaseOrders.expiresAt, status: purchaseOrders.status, notes: purchaseOrders.notes, companyName: crmCompanies.name, companyId: crmCompanies.id, showTitle: shows.title, episodeId: episodes.id, episodeNumber: episodes.number, episodeTitle: episodes.title }).from(purchaseOrders).innerJoin(crmCompanies, eq(purchaseOrders.companyId, crmCompanies.id)).leftJoin(shows, eq(purchaseOrders.showId, shows.id)).leftJoin(episodes, eq(purchaseOrders.episodeId, episodes.id)).where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.id, purchaseOrderId))).limit(1);
  if (!purchaseOrder) return null;
  const [events, costs, clientBillables, invoices] = await Promise.all([
    db.select().from(purchaseOrderEvents).where(and(eq(purchaseOrderEvents.organizationId, organizationId), eq(purchaseOrderEvents.purchaseOrderId, purchaseOrderId))).orderBy(desc(purchaseOrderEvents.createdAt)),
    db.select({ id: budgetLines.id, description: budgetLines.description, amount: budgetLines.actualAmount, currency: budgetLines.currency, episodeNumber: episodes.number, episodeTitle: episodes.title, createdAt: budgetLines.createdAt }).from(budgetLines).leftJoin(episodes, eq(budgetLines.episodeId, episodes.id)).where(and(eq(budgetLines.organizationId, organizationId), eq(budgetLines.purchaseOrderId, purchaseOrderId))).orderBy(desc(budgetLines.createdAt)),
    db.select({ id: billables.id, description: billables.description, amount: billables.amount, currency: billables.currency, status: billables.status, reference: billables.reference, createdAt: billables.createdAt }).from(billables).where(and(eq(billables.organizationId, organizationId), eq(billables.purchaseOrderId, purchaseOrderId))).orderBy(desc(billables.createdAt)),
    db.select({ id: vendorInvoices.id, invoiceNumber: vendorInvoices.invoiceNumber, amount: vendorInvoices.amount, currency: vendorInvoices.currency, status: vendorInvoices.status, dueDate: vendorInvoices.dueDate, description: vendorInvoices.description }).from(vendorInvoices).where(and(eq(vendorInvoices.organizationId, organizationId), eq(vendorInvoices.purchaseOrderId, purchaseOrderId))).orderBy(desc(vendorInvoices.createdAt)),
  ]);
  return { purchaseOrder, events, costs, clientBillables, invoices };
}

export async function getCrmAccount(organizationId: string, companyId: string) {
  const db = getDb();
  const [company] = await db.select().from(crmCompanies).where(and(eq(crmCompanies.organizationId, organizationId), eq(crmCompanies.id, companyId))).limit(1);
  if (!company) return null;
  const [contacts, relatedShows, invoices, workOrders, exposure, owners, cardRows, clientBillables] = await Promise.all([
    db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, organizationId), eq(crmContacts.companyId, companyId))).orderBy(asc(crmContacts.contactType), asc(crmContacts.name)),
    db.select({ id: shows.id, title: shows.title, code: shows.code, network: shows.network, activeEpisodeCount: sql<number>`count(${episodes.id}) filter (where ${episodes.status} <> 'delivered')` }).from(shows).leftJoin(seasons, and(eq(seasons.showId, shows.id), eq(seasons.organizationId, organizationId))).leftJoin(episodes, and(eq(episodes.seasonId, seasons.id), eq(episodes.organizationId, organizationId))).where(and(eq(shows.organizationId, organizationId), sql`(${shows.clientCompanyId} = ${companyId} or ${shows.productionCompanyId} = ${companyId})`)).groupBy(shows.id, shows.title, shows.code, shows.network).orderBy(asc(shows.title)),
    db.select({ id: vendorInvoices.id, invoiceNumber: vendorInvoices.invoiceNumber, amount: vendorInvoices.amount, currency: vendorInvoices.currency, status: vendorInvoices.status, dueDate: vendorInvoices.dueDate, createdAt: vendorInvoices.createdAt }).from(vendorInvoices).where(and(eq(vendorInvoices.organizationId, organizationId), eq(vendorInvoices.vendorCompanyId, companyId))).orderBy(desc(vendorInvoices.createdAt)),
    db.select({ id: postWorkOrders.id, title: postWorkOrders.title, status: postWorkOrders.status, dueAt: postWorkOrders.dueAt, episodeNumber: episodes.number, episodeTitle: episodes.title, createdAt: postWorkOrders.createdAt }).from(postWorkOrders).innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id)).where(and(eq(postWorkOrders.organizationId, organizationId), eq(postWorkOrders.vendorCompanyId, companyId), eq(episodes.organizationId, organizationId))).orderBy(asc(postWorkOrders.dueAt)),
    db.select({ value: sql<string>`coalesce(sum(${budgetLines.actualAmount}), 0)` }).from(budgetLines).leftJoin(episodes, eq(budgetLines.episodeId, episodes.id)).leftJoin(seasons, eq(episodes.seasonId, seasons.id)).leftJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(budgetLines.organizationId, organizationId), sql`(${shows.clientCompanyId} = ${companyId} or ${shows.productionCompanyId} = ${companyId})`)),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.isActive, true))).orderBy(asc(people.name)),
    db.select({ id: rateCardRecords.id, name: rateCardRecords.name, currency: rateCardRecords.currency, effectiveFrom: rateCardRecords.effectiveFrom, effectiveTo: rateCardRecords.effectiveTo, isActive: rateCardRecords.isActive, itemId: rateCardItems.id }).from(rateCardRecords).leftJoin(rateCardItems, and(eq(rateCardItems.rateCardId, rateCardRecords.id), eq(rateCardItems.organizationId, organizationId))).where(and(eq(rateCardRecords.organizationId, organizationId), eq(rateCardRecords.clientCompanyId, companyId))).orderBy(asc(rateCardRecords.name)),
    db.select({ id: billables.id, description: billables.description, amount: billables.amount, currency: billables.currency, status: billables.status, createdAt: billables.createdAt }).from(billables).innerJoin(shows, eq(billables.showId, shows.id)).where(and(eq(billables.organizationId, organizationId), eq(shows.organizationId, organizationId), or(eq(shows.clientCompanyId, companyId), eq(shows.productionCompanyId, companyId)))).orderBy(desc(billables.createdAt)),
  ]);

  const accountEvents = await db.select({ id: activityLog.id, action: activityLog.action, entityType: activityLog.entityType, entityId: activityLog.entityId, createdAt: activityLog.createdAt }).from(activityLog).where(and(eq(activityLog.organizationId, organizationId), eq(activityLog.entityType, "crm_company"), eq(activityLog.entityId, companyId))).orderBy(desc(activityLog.createdAt)).limit(20);
  const rateCards = Object.values(cardRows.reduce<Record<string, { id: string; name: string; currency: string; effectiveFrom: string | null; effectiveTo: string | null; isActive: boolean; itemCount: number }>>((result, row) => {
    result[row.id] ??= { id: row.id, name: row.name, currency: row.currency, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, isActive: row.isActive, itemCount: 0 };
    if (row.itemId) result[row.id].itemCount += 1;
    return result;
  }, {}));
  const activities = [
    ...accountEvents.map((event) => ({ id: `audit-${event.id}`, action: event.action, detail: company.name, createdAt: event.createdAt })),
    ...invoices.map((invoice) => ({ id: `invoice-${invoice.id}`, action: "vendor_invoice.recorded", detail: invoice.invoiceNumber, createdAt: invoice.createdAt })),
    ...clientBillables.map((billable) => ({ id: `billable-${billable.id}`, action: "client_billable.raised", detail: billable.description ?? "Client billable", createdAt: billable.createdAt })),
    ...workOrders.map((workOrder) => ({ id: `work-order-${workOrder.id}`, action: `work_order.${workOrder.status}`, detail: workOrder.title, createdAt: workOrder.createdAt })),
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 20);
  const financials = {
    invoicedAmount: (company.type === "vendor" ? invoices : clientBillables).reduce((total, item) => total + Number(item.amount), 0),
  };
  return { company, contacts, shows: relatedShows, activeShows: relatedShows.filter((show) => Number(show.activeEpisodeCount) > 0), pastShows: relatedShows.filter((show) => Number(show.activeEpisodeCount) === 0), invoices, workOrders, budgetExposure: Number(exposure[0]?.value ?? 0), owners, rateCards, activities, financials };
}

export async function listCrmCompanyOptions(organizationId: string) { return getDb().select({ id: crmCompanies.id, name: crmCompanies.name, type: crmCompanies.type }).from(crmCompanies).where(eq(crmCompanies.organizationId, organizationId)).orderBy(asc(crmCompanies.name)); }
