import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { crmCompanies, crmContacts, purchaseOrders, shows } from "@/lib/db/schema";

export async function getCrmData(organizationId: string) {
  const db = getDb();
  const [companies, contacts, purchaseOrderRows] = await Promise.all([
    db.select().from(crmCompanies).where(eq(crmCompanies.organizationId, organizationId)).orderBy(asc(crmCompanies.name)),
    db.select({ id: crmContacts.id, name: crmContacts.name, title: crmContacts.title, email: crmContacts.email, phone: crmContacts.phone, isPrimary: crmContacts.isPrimary, companyName: crmCompanies.name, companyType: crmCompanies.type }).from(crmContacts).innerJoin(crmCompanies, and(eq(crmContacts.companyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId))).where(eq(crmContacts.organizationId, organizationId)).orderBy(asc(crmContacts.name)),
    db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, amount: purchaseOrders.amount, currency: purchaseOrders.currency, status: purchaseOrders.status, companyName: crmCompanies.name, showTitle: shows.title }).from(purchaseOrders).innerJoin(crmCompanies, eq(purchaseOrders.companyId, crmCompanies.id)).leftJoin(shows, eq(purchaseOrders.showId, shows.id)).where(eq(purchaseOrders.organizationId, organizationId)).orderBy(asc(purchaseOrders.poNumber)),
  ]);
  return { companies, contacts, purchaseOrders: purchaseOrderRows };
}

export async function listCrmCompanyOptions(organizationId: string) { return getDb().select({ id: crmCompanies.id, name: crmCompanies.name, type: crmCompanies.type }).from(crmCompanies).where(eq(crmCompanies.organizationId, organizationId)).orderBy(asc(crmCompanies.name)); }
