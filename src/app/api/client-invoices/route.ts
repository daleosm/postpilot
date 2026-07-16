import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { billables, clientInvoiceItems, clientInvoices } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { getEpisodeInvoiceReadiness, getInvoiceSettings } from "@/server/data";

const requestSchema = z.object({ episodeId: z.string().uuid() });

class InvoiceIssueConflict extends Error {}

/** Issues an immutable client invoice from approved, uninvoiced episode charges. */
export async function POST(request: Request) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid episode." }, { status: 400 });

  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organization = context.organization;
  const organizationId = organization.organizationId;
  const readiness = await getEpisodeInvoiceReadiness(organizationId, parsed.data.episodeId);
  if (!readiness.episode) return NextResponse.json({ error: "Episode not found." }, { status: 404 });
  if (!readiness.readyToIssue) return NextResponse.json({ error: readiness.blockedReason ?? "This invoice is not ready to issue." }, { status: 409 });

  const settings = await getInvoiceSettings(organizationId);
  const invoiceDate = formatDate(new Date());
  const termsDays = settings?.paymentTermsDays ?? readiness.episode.paymentTermsDays ?? 30;
  const due = new Date(); due.setDate(due.getDate() + termsDays);
  const dueDate = formatDate(due);
  const subtotal = roundMoney(readiness.billables.reduce((sum, item) => sum + Number(item.amount), 0));
  const taxRate = Number(settings?.taxRatePercent ?? "0");
  const taxAmount = roundMoney(subtotal * taxRate / 100);
  const totalAmount = roundMoney(subtotal + taxAmount);
  const currency = organization.currency;
  const issuerName = settings?.legalName?.trim() || organization.organizationName;
  const billingIds = readiness.billables.map((item) => item.id);

  let invoice: { id: string; invoiceNumber: string };
  try {
    invoice = await getDb().transaction(async (tx) => {
    // A tenant-scoped transaction lock preserves the legal sequential invoice number under concurrent issue requests.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`postpilot-client-invoices:${organizationId}`}))`);
    const claimable = await tx.select({ id: billables.id }).from(billables)
      .where(and(eq(billables.organizationId, organizationId), inArray(billables.id, billingIds), eq(billables.status, "approved"), isNull(billables.clientInvoiceId)));
    if (claimable.length !== billingIds.length) throw new InvoiceIssueConflict("One or more client charges were already invoiced.");
    const [latest] = await tx.select({ sequence: sql<number>`coalesce(max(${clientInvoices.sequence}), 0)` }).from(clientInvoices)
      .where(eq(clientInvoices.organizationId, organizationId));
    const sequence = Number(latest?.sequence ?? 0) + 1;
    const invoiceNumber = `${invoicePrefix(organization.organizationSlug)}-${invoiceDate.slice(0, 4)}-${String(sequence).padStart(4, "0")}`;
    const [created] = await tx.insert(clientInvoices).values({
      organizationId,
      sequence,
      invoiceNumber,
      clientCompanyId: readiness.episode!.clientCompanyId,
      showId: readiness.episode!.showId,
      episodeId: readiness.episode!.id,
      status: "issued",
      invoiceDate,
      dueDate,
      currency,
      subtotalAmount: String(subtotal),
      taxName: settings?.taxName ?? "VAT",
      taxRatePercent: String(taxRate),
      taxAmount: String(taxAmount),
      totalAmount: String(totalAmount),
      issuerName,
      issuerAddress: settings?.legalAddress ?? null,
      issuerEmail: settings?.billingEmail ?? null,
      issuerTaxRegistrationNumber: settings?.taxRegistrationNumber ?? null,
      clientName: readiness.episode!.clientName!,
      clientAddress: readiness.episode!.clientAddress ?? null,
      clientEmail: readiness.episode!.clientEmail ?? null,
      paymentInstructions: settings?.paymentInstructions ?? null,
    }).returning({ id: clientInvoices.id, invoiceNumber: clientInvoices.invoiceNumber });

    await tx.insert(clientInvoiceItems).values(readiness.billables.map((item) => ({
      organizationId,
      clientInvoiceId: created.id,
      billableId: item.id,
      description: item.description?.trim() || "Post-production services",
      reference: item.reference,
      quantity: "1",
      unitAmount: item.amount,
      amount: item.amount,
    })));
    const linked = await tx.update(billables).set({ clientInvoiceId: created.id, status: "invoiced", invoiceDate, dueDate, updatedAt: new Date() })
      .where(and(eq(billables.organizationId, organizationId), inArray(billables.id, billingIds), eq(billables.status, "approved"), isNull(billables.clientInvoiceId)))
      .returning({ id: billables.id });
    if (linked.length !== billingIds.length) throw new InvoiceIssueConflict("One or more client charges were already invoiced.");
    return created;
    });
  } catch (error) {
    if (error instanceof InvoiceIssueConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }

  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "client_invoice.issued", entityType: "client_invoice", entityId: invoice.id, metadata: { episodeId: readiness.episode.id, invoiceNumber: invoice.invoiceNumber, subtotal, taxAmount, totalAmount, currency } });
  return NextResponse.json(invoice, { status: 201 });
}

function formatDate(value: Date) { return value.toISOString().slice(0, 10); }
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function invoicePrefix(slug: string) { return slug.replaceAll(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10) || "POSTPILOT"; }
