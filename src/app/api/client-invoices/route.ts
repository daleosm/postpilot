import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { billables, clientInvoiceItems, clientInvoices, clientPurchaseOrderAllocations, clientPurchaseOrders } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { getEpisodeInvoiceReadiness, getInvoiceSettings } from "@/server/data";

const requestSchema = z.object({
  episodeId: z.string().uuid(),
  clientPoOverruns: z.array(z.object({ clientPurchaseOrderId: z.string().uuid(), reason: z.string().trim().min(8).max(2000) })).default([]),
  clientPoOverrunReason: z.string().trim().min(8).max(2000).optional(),
});

class InvoiceIssueConflict extends Error {}
class InvoiceIssueError extends Error { constructor(public readonly status: number, message: string) { super(message); } }

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
  const taxEnabled = settings?.taxEnabled ?? false;
  const taxRate = taxEnabled ? Number(settings?.taxRatePercent ?? "0") : 0;
  const taxAmount = roundMoney(subtotal * taxRate / 100);
  const totalAmount = roundMoney(subtotal + taxAmount);
  const currency = organization.currency;
  const issuerName = settings?.legalName?.trim() || organization.organizationName;
  const billingIds = readiness.billables.map((item) => item.id);
  const overrunReasons = new Map(parsed.data.clientPoOverruns.map((entry) => [entry.clientPurchaseOrderId, entry.reason]));
  const mayApproveOverruns = await can("approve_budget_overruns");
  const clientPoInvoiceAllocations: Array<{ clientPurchaseOrderId: string; invoiceItemId: string; amount: string; overrunAuthorised: boolean }> = [];

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
      taxEnabled,
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

    const invoiceItems = await tx.insert(clientInvoiceItems).values(readiness.billables.map((item) => ({
      organizationId,
      clientInvoiceId: created.id,
      billableId: item.id,
      clientPurchaseOrderId: item.clientPurchaseOrderId,
      description: item.description?.trim() || "Post-production services",
      reference: item.reference,
      quantity: "1",
      unitAmount: item.amount,
      amount: item.amount,
    }))).returning({ id: clientInvoiceItems.id, billableId: clientInvoiceItems.billableId, clientPurchaseOrderId: clientInvoiceItems.clientPurchaseOrderId, amount: clientInvoiceItems.amount, description: clientInvoiceItems.description, reference: clientInvoiceItems.reference });

    for (const item of invoiceItems.filter((candidate) => candidate.clientPurchaseOrderId)) {
      const purchaseOrderId = item.clientPurchaseOrderId!;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`postpilot-client-po:${purchaseOrderId}`}))`);
      const [purchaseOrder] = await tx.select({ id: clientPurchaseOrders.id, clientCompanyId: clientPurchaseOrders.clientCompanyId, showId: clientPurchaseOrders.showId, episodeId: clientPurchaseOrders.episodeId, status: clientPurchaseOrders.status, expiryDate: clientPurchaseOrders.expiryDate, approvedAmount: clientPurchaseOrders.approvedAmount })
        .from(clientPurchaseOrders).where(and(eq(clientPurchaseOrders.id, purchaseOrderId), eq(clientPurchaseOrders.organizationId, organizationId))).limit(1);
      if (!purchaseOrder || purchaseOrder.status !== "active" || purchaseOrder.clientCompanyId !== readiness.episode!.clientCompanyId || (purchaseOrder.showId && purchaseOrder.showId !== readiness.episode!.showId) || (purchaseOrder.episodeId && purchaseOrder.episodeId !== readiness.episode!.id) || (purchaseOrder.expiryDate && purchaseOrder.expiryDate < invoiceDate)) {
        throw new InvoiceIssueError(409, "An attached client PO is no longer active or does not apply to this invoice.");
      }
      const [totals] = await tx.select({ invoiced: sql<string>`coalesce(sum(case when ${clientPurchaseOrderAllocations.allocationType} = 'client_invoice' then ${clientPurchaseOrderAllocations.amount} else 0 end), 0)` })
        .from(clientPurchaseOrderAllocations).where(and(eq(clientPurchaseOrderAllocations.organizationId, organizationId), eq(clientPurchaseOrderAllocations.clientPurchaseOrderId, purchaseOrderId)));
      const overrun = Number(totals?.invoiced ?? 0) + Number(item.amount) - Number(purchaseOrder.approvedAmount);
      if (overrun > 0) {
        if (!(overrunReasons.get(purchaseOrderId) ?? parsed.data.clientPoOverrunReason)) throw new InvoiceIssueError(400, `Client PO ${purchaseOrderId} would be exceeded by ${overrun.toFixed(2)}. Supply an overrun reason.`);
        if (!mayApproveOverruns) throw new InvoiceIssueError(403, "Your role needs the Budget approval permission to authorise this client PO overrun.");
      }
      const overrunAuthorised = overrun > 0;
      await tx.insert(clientPurchaseOrderAllocations).values({ organizationId, clientPurchaseOrderId: purchaseOrderId, allocationType: "client_invoice", clientInvoiceItemId: item.id, amount: item.amount, overrunAuthorised, allocationDate: invoiceDate, reference: item.reference, description: item.description, createdByUserId: context.userId });
      clientPoInvoiceAllocations.push({ clientPurchaseOrderId: purchaseOrderId, invoiceItemId: item.id, amount: item.amount, overrunAuthorised });
    }
    const linked = await tx.update(billables).set({ clientInvoiceId: created.id, status: "invoiced", invoiceDate, dueDate, updatedAt: new Date() })
      .where(and(eq(billables.organizationId, organizationId), inArray(billables.id, billingIds), eq(billables.status, "approved"), isNull(billables.clientInvoiceId)))
      .returning({ id: billables.id });
    if (linked.length !== billingIds.length) throw new InvoiceIssueConflict("One or more client charges were already invoiced.");
    return created;
    });
  } catch (error) {
    if (error instanceof InvoiceIssueConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof InvoiceIssueError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "client_invoice.issued", entityType: "client_invoice", entityId: invoice.id, metadata: { episodeId: readiness.episode.id, invoiceNumber: invoice.invoiceNumber, subtotal, taxAmount, totalAmount, currency } });
  await Promise.all(clientPoInvoiceAllocations.map((allocation) => writeAuditEvent({ organizationId, actorUserId: context.userId, action: allocation.overrunAuthorised ? "client_purchase_order.overrun_authorised" : "client_purchase_order.invoice_entered", entityType: "client_purchase_order", entityId: allocation.clientPurchaseOrderId, metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceItemId: allocation.invoiceItemId, allocationType: "client_invoice", amount: allocation.amount } })));
  return NextResponse.json(invoice, { status: 201 });
}

function formatDate(value: Date) { return value.toISOString().slice(0, 10); }
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function invoicePrefix(slug: string) { return slug.replaceAll(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10) || "POSTPILOT"; }
