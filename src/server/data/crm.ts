import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { crmCompanies, crmContacts, purchaseOrders, rateCardItems, rateCards as rateCardRecords, shows } from "@/lib/db/schema";

export async function getCrmData(organizationId: string) {
  const db = getDb();
  const [companies, contacts, purchaseOrderRows, cards] = await Promise.all([
    db.select().from(crmCompanies).where(eq(crmCompanies.organizationId, organizationId)).orderBy(asc(crmCompanies.name)),
    db.select({ id: crmContacts.id, name: crmContacts.name, title: crmContacts.title, email: crmContacts.email, phone: crmContacts.phone, isPrimary: crmContacts.isPrimary, companyName: crmCompanies.name, companyType: crmCompanies.type }).from(crmContacts).innerJoin(crmCompanies, and(eq(crmContacts.companyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId))).where(eq(crmContacts.organizationId, organizationId)).orderBy(asc(crmContacts.name)),
    db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, amount: purchaseOrders.amount, currency: purchaseOrders.currency, status: purchaseOrders.status, companyName: crmCompanies.name, showTitle: shows.title }).from(purchaseOrders).innerJoin(crmCompanies, eq(purchaseOrders.companyId, crmCompanies.id)).leftJoin(shows, eq(purchaseOrders.showId, shows.id)).where(eq(purchaseOrders.organizationId, organizationId)).orderBy(asc(purchaseOrders.poNumber)),
    db.select({ id: rateCardRecords.id, name: rateCardRecords.name, currency: rateCardRecords.currency, showTitle: shows.title, companyName: crmCompanies.name, itemId: rateCardItems.id }).from(rateCardRecords).leftJoin(shows, eq(rateCardRecords.showId, shows.id)).leftJoin(crmCompanies, eq(rateCardRecords.clientCompanyId, crmCompanies.id)).leftJoin(rateCardItems, eq(rateCardItems.rateCardId, rateCardRecords.id)).where(eq(rateCardRecords.organizationId, organizationId)).orderBy(asc(rateCardRecords.name)),
  ]);
  const rateCards = Object.values(cards.reduce<Record<string, { id: string; name: string; currency: string; showTitle: string | null; companyName: string | null; itemCount: number }>>((result, card) => { result[card.id] ??= { id: card.id, name: card.name, currency: card.currency, showTitle: card.showTitle, companyName: card.companyName, itemCount: 0 }; if (card.itemId) result[card.id].itemCount += 1; return result; }, {}));
  return { companies, contacts, purchaseOrders: purchaseOrderRows, rateCards };
}

export async function listCrmCompanyOptions(organizationId: string) { return getDb().select({ id: crmCompanies.id, name: crmCompanies.name, type: crmCompanies.type }).from(crmCompanies).where(eq(crmCompanies.organizationId, organizationId)).orderBy(asc(crmCompanies.name)); }
