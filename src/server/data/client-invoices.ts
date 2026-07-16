import "server-only";

import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { billables, bookings, clientInvoices, crmCompanies, episodes, invoiceSettings, people, seasons, shows, workflowStages } from "@/lib/db/schema";

export type InvoiceReadiness = {
  episode: { id: string; title: string; number: number; productionCode: string | null; showId: string; showTitle: string; clientCompanyId: string | null; clientName: string | null; clientAddress: string | null; clientEmail: string | null; paymentTermsDays: number | null; workflowStageName: string | null; workflowComplete: boolean } | null;
  unconfirmedBookings: Array<{ id: string; title: string; personName: string | null }>;
  billables: Array<{ id: string; description: string | null; reference: string | null; amount: string; currency: string }>;
  invoices: Array<{ id: string; invoiceNumber: string; status: "issued" | "paid" | "void"; invoiceDate: string; dueDate: string; totalAmount: string; currency: string }>;
  invoiceProfileComplete: boolean;
  readyToIssue: boolean;
  blockedReason: string | null;
};

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
    workflowStageName: workflowStages.name,
    workflowComplete: sql<boolean>`coalesce(${workflowStages.isTerminal}, false)`,
  }).from(episodes)
    .innerJoin(seasons, and(eq(episodes.seasonId, seasons.id), eq(seasons.organizationId, organizationId)))
    .innerJoin(shows, and(eq(seasons.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(crmCompanies, and(eq(shows.clientCompanyId, crmCompanies.id), eq(crmCompanies.organizationId, organizationId)))
    .leftJoin(workflowStages, and(eq(episodes.workflowStageId, workflowStages.id), eq(workflowStages.organizationId, organizationId)))
    .where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, organizationId))).limit(1);

  if (!episode) return { episode: null, unconfirmedBookings: [], billables: [], invoices: [], invoiceProfileComplete: false, readyToIssue: false, blockedReason: "Episode not found." };

  const [unconfirmedBookings, approvedBillables, issuedInvoices, profileRows] = await Promise.all([
    db.select({ id: bookings.id, title: bookings.title, personName: people.name }).from(bookings)
      .leftJoin(people, and(eq(bookings.personId, people.id), eq(people.organizationId, organizationId)))
      .where(and(
        eq(bookings.organizationId, organizationId),
        eq(bookings.episodeId, episodeId),
        isNotNull(bookings.personId),
        ne(bookings.status, "cancelled"),
        or(isNull(bookings.actualStartsAt), isNull(bookings.actualEndsAt)),
      )).orderBy(asc(bookings.startsAt)),
    db.select({ id: billables.id, description: billables.description, reference: billables.reference, amount: billables.amount, currency: billables.currency }).from(billables)
      .where(and(eq(billables.organizationId, organizationId), eq(billables.episodeId, episodeId), eq(billables.status, "approved"), isNull(billables.clientInvoiceId))).orderBy(asc(billables.createdAt)),
    db.select({ id: clientInvoices.id, invoiceNumber: clientInvoices.invoiceNumber, status: clientInvoices.status, invoiceDate: clientInvoices.invoiceDate, dueDate: clientInvoices.dueDate, totalAmount: clientInvoices.totalAmount, currency: clientInvoices.currency }).from(clientInvoices)
      .where(and(eq(clientInvoices.organizationId, organizationId), eq(clientInvoices.episodeId, episodeId))).orderBy(asc(clientInvoices.sequence)),
    db.select({ legalName: invoiceSettings.legalName, legalAddress: invoiceSettings.legalAddress }).from(invoiceSettings).where(eq(invoiceSettings.organizationId, organizationId)).limit(1),
  ]);

  const clientMissing = !episode.clientCompanyId || !episode.clientName;
  const invoiceProfileComplete = Boolean(profileRows[0]?.legalName?.trim() && profileRows[0]?.legalAddress?.trim());
  const readyToIssue = invoiceProfileComplete && !clientMissing && episode.workflowComplete && unconfirmedBookings.length === 0 && approvedBillables.length > 0;
  const blockedReason = clientMissing
    ? "Assign a client or production company to the show before issuing an invoice."
    : !invoiceProfileComplete
      ? "Complete the invoicing profile with the legal entity name and registered address before issuing an invoice."
    : !episode.workflowComplete
      ? `Complete the episode workflow before issuing an invoice${episode.workflowStageName ? ` (currently ${episode.workflowStageName})` : ""}.`
    : unconfirmedBookings.length
      ? `${unconfirmedBookings.length} assigned booking${unconfirmedBookings.length === 1 ? "" : "s"} still need actual time confirmed.`
      : approvedBillables.length === 0
        ? "No approved client charges are ready to invoice."
        : null;

  return {
    episode,
    unconfirmedBookings,
    billables: approvedBillables,
    invoices: issuedInvoices,
    invoiceProfileComplete,
    readyToIssue,
    blockedReason,
  };
}

export async function getInvoiceSettings(organizationId: string) {
  const [settings] = await getDb().select().from(invoiceSettings).where(eq(invoiceSettings.organizationId, organizationId)).limit(1);
  return settings ?? null;
}
