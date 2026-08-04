"use client";

import { Button } from "@heroui/react";
import { CheckCircle2, Download, FileText, LockKeyhole, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postpilotApiFetch } from "@/lib/postpilot-api-client";

type InvoiceReadiness = {
  episode: { workflowStageName: string | null; workflowComplete: boolean; clientName: string | null } | null;
  unconfirmedBookings: Array<{ id: string; title: string; personName: string | null }>;
  billables: Array<{ id: string; description: string | null; reference: string | null; amount: string; currency: string; clientPurchaseOrderId: string | null }>;
  bookingComponents: Array<{
    id: string; bookingId: string; bookingTitle: string; bookingDate: string | null; componentType: "room" | "person";
    resource: string; category: string; unit: string; currency: string; rate: number; overtimeMultiplier: number;
    actualQuantity: number; actualOvertimeQuantity: number; baseAmount: number; overtimeAmount: number; actualAmount: number;
    selectionStatus: "awaiting_selection" | "included" | "excluded" | "invoiced"; selectionReason: string | null;
  }>;
  invoices: Array<{ id: string; invoiceNumber: string; status: "issued" | "paid" | "void"; invoiceDate: string; dueDate: string; totalAmount: string; currency: string; exportBlockedReason: string | null }>;
  invoiceProfileComplete: boolean;
  clientPoWarnings: Array<{ clientPurchaseOrderId: string; poNumber: string; kind: string; message: string; blocksBilling: boolean }>;
  readyToIssue: boolean;
  blockedReason: string | null;
};

export function EpisodeInvoicePanel({ episodeId, readiness }: { episodeId: string; readiness: InvoiceReadiness | null }) {
  const router = useRouter();
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState("");
  const [clientPoOverrunReason, setClientPoOverrunReason] = useState("");
  const [needsOverrunReason, setNeedsOverrunReason] = useState(false);
  if (!readiness) return null;
  const invoiceReadiness = readiness;

  async function issueAndDownload() {
    setIssuing(true); setMessage("");
    try {
      const body = await postpilotApiFetch<{ id: string }>("/billing/invoices", {
        method: "POST",
        body: {
          episode_id: episodeId,
          client_po_overruns: clientPoOverrunReason
            ? invoiceReadiness.clientPoWarnings.filter((warning) => warning.blocksBilling).map((warning) => ({ client_purchase_order_id: warning.clientPurchaseOrderId, reason: clientPoOverrunReason }))
            : [],
        },
      });
      router.refresh();
      window.location.assign(`/v1/billing/invoices/${body.id}/export`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not issue this invoice.";
      setMessage(message);
      setNeedsOverrunReason(message.toLowerCase().includes("overrun") || message.toLowerCase().includes("exceeded"));
    } finally {
      setIssuing(false);
    }
  }

  return <section className="panel overflow-hidden">
    <div className="flex flex-col justify-between gap-4 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-start">
      <div><div className="flex items-center gap-2 text-sm font-semibold text-[#343b38]"><FileText size={16} className="text-[#59756c]" /> Client invoice</div><p className="mt-1 text-xs leading-5 text-[#7d837f]">Issue approved client charges as an immutable PDF invoice. Export remains locked until the episode is complete and every assigned booking has confirmed actual time.</p></div>
      <Button variant="primary" onPress={issueAndDownload} isDisabled={!readiness.readyToIssue || issuing} className="bg-[#476f61] text-white disabled:opacity-50"><Send size={14} />{issuing ? "Issuing…" : "Issue & download PDF"}</Button>
    </div>
    <div className="grid divide-y divide-[#efeeea] md:grid-cols-3 md:divide-x md:divide-y-0">
      <Status label="Issuer profile" ok={readiness.invoiceProfileComplete} detail={readiness.invoiceProfileComplete ? "Legal entity and address configured" : "Add legal entity and registered address in Invoicing settings"} />
      <Status label="Workflow" ok={Boolean(readiness.episode?.workflowComplete)} detail={readiness.episode?.workflowComplete ? "Terminal workflow stage reached" : readiness.episode?.workflowStageName ? `Currently ${readiness.episode.workflowStageName}` : "No terminal workflow stage reached"} />
      <Status label="Actual time" ok={readiness.unconfirmedBookings.length === 0 && readiness.billables.length > 0} detail={readiness.unconfirmedBookings.length ? `${readiness.unconfirmedBookings.length} booking${readiness.unconfirmedBookings.length === 1 ? "" : "s"} awaiting confirmation` : readiness.billables.length ? "All actuals confirmed; charges ready" : "No approved client charges"} />
    </div>
    {readiness.blockedReason && <div className="flex gap-2 border-t border-[#f0e1d8] bg-[#fffaf6] px-5 py-3 text-xs text-[#936044]"><LockKeyhole size={14} className="mt-0.5 shrink-0" /><p>{readiness.blockedReason}</p></div>}
    {readiness.clientPoWarnings.length > 0 && <div className="border-t border-[#efdfd7] bg-[#fffaf8] px-5 py-3"><p className="text-xs font-semibold text-[#8a5e45]">Client PO safeguards</p><ul className="mt-1 space-y-1 text-xs leading-5 text-[#8a5e45]">{readiness.clientPoWarnings.map((warning) => <li key={`${warning.clientPurchaseOrderId}-${warning.kind}`}>{warning.message}{warning.blocksBilling ? " Billing is blocked." : ""}</li>)}</ul></div>}
    {readiness.unconfirmedBookings.length > 0 && <div className="border-t border-[#efeeea] px-5 py-3"><p className="text-xs font-semibold text-[#59635e]">Awaiting actual time</p><p className="mt-1 text-xs text-[#858a87]">{readiness.unconfirmedBookings.map((booking) => `${booking.title}${booking.personName ? ` · ${booking.personName}` : ""}`).join("; ")}</p></div>}
    <BookingComponentInvoiceQueue components={readiness.bookingComponents} />
    {needsOverrunReason && <div className="border-t border-[#f0e1d8] bg-[#fffaf6] px-5 py-3"><label className="block text-xs font-semibold text-[#8a5e45]">Client PO overrun reason<textarea value={clientPoOverrunReason} onChange={(event) => setClientPoOverrunReason(event.target.value)} rows={2} className="mt-1.5 block w-full rounded-md border border-[#dfc7bc] bg-white px-3 py-2 text-sm text-[#424a46]" placeholder="Record the approved scope change or client authorisation before issuing." /></label></div>}
    {readiness.invoices.length > 0 && <div className="border-t border-[#efeeea]"><div className="px-5 py-3 text-xs font-semibold text-[#59635e]">Issued invoices</div><div className="divide-y divide-[#efeeea]">{readiness.invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium text-[#39423e]">{invoice.invoiceNumber}</p><p className="mt-1 text-xs text-[#858a87]">Issued {formatDate(invoice.invoiceDate)} · Due {formatDate(invoice.dueDate)} · {invoice.currency} {Number(invoice.totalAmount).toFixed(2)}</p>{invoice.exportBlockedReason && <p className="mt-1 text-xs text-[#a35e41]">PDF export blocked · {invoice.exportBlockedReason}</p>}</div>{invoice.status === "void" ? <span className="text-xs font-semibold text-[#a65f42]">Void</span> : invoice.exportBlockedReason ? <span className="text-xs font-semibold text-[#a35e41]">Export locked</span> : <a href={`/v1/billing/invoices/${invoice.id}/export`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dce5df] bg-white px-3 text-xs font-semibold text-[#45675d] transition-colors hover:bg-[#f3f7f4]"><Download size={14} /> PDF</a>}</div>)}</div></div>}
    {message && <p role="alert" className="border-t border-[#f0e1d8] px-5 py-3 text-xs text-[#a65f42]">{message}</p>}
  </section>;
}

function BookingComponentInvoiceQueue({ components }: { components: InvoiceReadiness["bookingComponents"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  if (!components.length) return null;
  async function setSelection(component: InvoiceReadiness["bookingComponents"][number], include: boolean) {
    const reason = reasonById[component.id]?.trim();
    if (!include && !reason) { setMessage("Explain why a room or artist actual is excluded."); return; }
    setBusy(component.id); setMessage("");
    try {
      await postpilotApiFetch(`/billing/booking-components/${component.id}/invoice-selection`, {
        method: "PUT",
        body: { include_in_invoice: include, reason: reason || null },
      });
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update invoice selection."); }
    finally { setBusy(null); }
  }
  return <div className="border-t border-[#efeeea]">
    <div className="px-5 py-3"><p className="text-xs font-semibold text-[#59635e]">Booking actuals</p><p className="mt-1 text-xs leading-5 text-[#858a87]">Select each confirmed room or artist charge deliberately. Each resource stays itemised on the invoice; approved overtime is shown separately.</p></div>
    <div className="overflow-x-auto border-t border-[#efeeea]"><div className="min-w-[850px]"><div className="grid grid-cols-[minmax(220px,1.5fr)_110px_110px_110px_140px] gap-3 bg-[#f7f7f4] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[.08em] text-[#717974]"><span>Booking / resource</span><span>Actual</span><span>Saved rate</span><span>Total</span><span>Invoice selection</span></div><div className="divide-y divide-[#efeeea]">{components.map((component) => {
      const editable = component.selectionStatus !== "invoiced";
      const included = component.selectionStatus === "included";
      const excluded = component.selectionStatus === "excluded";
      return <div key={component.id} className="grid grid-cols-[minmax(220px,1.5fr)_110px_110px_110px_140px] gap-3 px-5 py-3 text-xs text-[#59635e]"><div className="min-w-0"><p className="truncate font-semibold text-[#39423e]">{component.resource}</p><p className="mt-1 truncate text-[#858a87]">{component.bookingTitle}{component.bookingDate ? ` · ${component.bookingDate}` : ""}</p><p className="mt-1 text-[11px] text-[#737b77]">{component.componentType === "room" ? "Room" : "Artist"} · {component.category}</p>{component.actualOvertimeQuantity > 0 && <p className="mt-1 text-[11px] text-[#8a6541]">+ {component.actualOvertimeQuantity} {component.unit} overtime at {component.overtimeMultiplier}×</p>}</div><span>{component.actualQuantity} {component.unit}</span><span>{component.currency} {component.rate.toFixed(2)}</span><span className="font-semibold text-[#39423e]">{component.currency} {component.actualAmount.toFixed(2)}</span><div>{component.selectionStatus === "invoiced" ? <span className="font-semibold text-[#59756c]">Invoiced</span> : <div className="space-y-2">{!included && <Button size="sm" variant="primary" isDisabled={!editable || busy === component.id} onPress={() => setSelection(component, true)} className="w-full bg-[#476f61] text-white">{busy === component.id ? "Saving…" : "Include"}</Button>}{included && <span className="font-semibold text-[#59756c]">Included</span>}{(excluded || included || component.selectionStatus === "awaiting_selection") && <><input aria-label={`Exclusion reason for ${component.resource}`} value={reasonById[component.id] ?? component.selectionReason ?? ""} onChange={(event) => setReasonById((current) => ({ ...current, [component.id]: event.target.value }))} placeholder="Reason to exclude" className="h-8 w-full rounded-md border border-[#dedfda] bg-[#fcfcfa] px-2 text-[11px] text-[#45504b]" /><Button size="sm" variant="tertiary" isDisabled={!editable || busy === component.id} onPress={() => setSelection(component, false)} className="w-full">Exclude</Button></>}</div>}</div></div>;
    })}</div></div></div>{message && <p role="alert" className="border-t border-[#f0e1d8] px-5 py-3 text-xs text-[#a35e41]">{message}</p>}</div>;
}

function Status({ label, ok, detail }: { label: string; ok: boolean; detail: string }) { return <div className="px-5 py-4"><div className={`flex items-center gap-2 text-xs font-semibold ${ok ? "text-[#4f7767]" : "text-[#a65f42]"}`}>{ok ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}{label}</div><p className="mt-2 text-xs leading-5 text-[#747c77]">{detail}</p></div>; }
function formatDate(value: string) { const [year, month, day] = value.split("-"); return year && month && day ? `${day}/${month}/${year}` : value; }
