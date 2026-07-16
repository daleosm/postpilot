import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { createClientInvoicePdf } from "@/lib/client-invoice-pdf";
import { getDb } from "@/lib/db";
import { clientInvoiceItems, clientInvoices, episodes, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { getEpisodeInvoiceReadiness } from "@/server/data";

/** Downloads an issued invoice only after workflow completion and actual-time confirmation are still true. */
export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  if (!(await can("manage_budget"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { invoiceId } = await params;
  const organizationId = context.organization.organizationId;
  const db = getDb();
  const [invoice] = await db.select({
    id: clientInvoices.id,
    invoiceNumber: clientInvoices.invoiceNumber,
    status: clientInvoices.status,
    episodeId: clientInvoices.episodeId,
    invoiceDate: clientInvoices.invoiceDate,
    dueDate: clientInvoices.dueDate,
    currency: clientInvoices.currency,
    subtotal: clientInvoices.subtotalAmount,
    taxEnabled: clientInvoices.taxEnabled,
    taxName: clientInvoices.taxName,
    taxRate: clientInvoices.taxRatePercent,
    taxAmount: clientInvoices.taxAmount,
    total: clientInvoices.totalAmount,
    issuerName: clientInvoices.issuerName,
    issuerAddress: clientInvoices.issuerAddress,
    issuerEmail: clientInvoices.issuerEmail,
    issuerTaxNumber: clientInvoices.issuerTaxRegistrationNumber,
    clientName: clientInvoices.clientName,
    clientAddress: clientInvoices.clientAddress,
    clientEmail: clientInvoices.clientEmail,
    paymentInstructions: clientInvoices.paymentInstructions,
    showTitle: shows.title,
    episodeTitle: episodes.title,
    episodeNumber: episodes.number,
    episodeCode: episodes.productionCode,
  }).from(clientInvoices)
    .leftJoin(shows, and(eq(clientInvoices.showId, shows.id), eq(shows.organizationId, organizationId)))
    .leftJoin(episodes, and(eq(clientInvoices.episodeId, episodes.id), eq(episodes.organizationId, organizationId)))
    .where(and(eq(clientInvoices.id, invoiceId), eq(clientInvoices.organizationId, organizationId))).limit(1);
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (invoice.status === "void") return NextResponse.json({ error: "A void invoice cannot be exported." }, { status: 409 });
  if (!invoice.episodeId) return NextResponse.json({ error: "This invoice is not linked to an episode." }, { status: 409 });

  const readiness = await getEpisodeInvoiceReadiness(organizationId, invoice.episodeId);
  if (!readiness.episode?.workflowComplete || readiness.unconfirmedBookings.length) {
    const problem = !readiness.episode?.workflowComplete
      ? "Complete the episode workflow before exporting its invoice."
      : `${readiness.unconfirmedBookings.length} assigned booking${readiness.unconfirmedBookings.length === 1 ? " still needs" : "s still need"} actual time confirmed before invoice export.`;
    return NextResponse.json({ error: problem }, { status: 409 });
  }

  const items = await db.select({ description: clientInvoiceItems.description, reference: clientInvoiceItems.reference, quantity: clientInvoiceItems.quantity, unitAmount: clientInvoiceItems.unitAmount, amount: clientInvoiceItems.amount })
    .from(clientInvoiceItems).where(and(eq(clientInvoiceItems.organizationId, organizationId), eq(clientInvoiceItems.clientInvoiceId, invoice.id))).orderBy(asc(clientInvoiceItems.createdAt));
  const pdf = createClientInvoicePdf({
    issuer: { name: invoice.issuerName, address: invoice.issuerAddress, email: invoice.issuerEmail, taxName: invoice.taxName, taxNumber: invoice.issuerTaxNumber, paymentInstructions: invoice.paymentInstructions },
    client: { name: invoice.clientName, address: invoice.clientAddress, email: invoice.clientEmail },
    invoice: { number: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate, currency: invoice.currency, subtotal: Number(invoice.subtotal), taxEnabled: invoice.taxEnabled, taxRate: Number(invoice.taxRate), taxAmount: Number(invoice.taxAmount), total: Number(invoice.total), showTitle: invoice.showTitle, episodeLabel: invoice.episodeTitle ? `${invoice.episodeCode ?? `E${String(invoice.episodeNumber ?? 0).padStart(2, "0")}`} ${invoice.episodeTitle}` : null },
    items: items.map((item) => ({ description: item.description, reference: item.reference, quantity: Number(item.quantity), unitAmount: Number(item.unitAmount), amount: Number(item.amount) })),
  });
  const filename = `invoice-${invoice.invoiceNumber.replaceAll(/[^a-z0-9_-]/gi, "-")}.pdf`;
  return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=\"${filename}\"`, "Cache-Control": "private, no-store" } });
}
