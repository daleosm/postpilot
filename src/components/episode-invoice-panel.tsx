"use client";

import { Button } from "@heroui/react";
import { CheckCircle2, Download, FileText, LockKeyhole, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type InvoiceReadiness = {
  episode: { workflowStageName: string | null; workflowComplete: boolean; clientName: string | null } | null;
  unconfirmedBookings: Array<{ id: string; title: string; personName: string | null }>;
  billables: Array<{ id: string; description: string | null; reference: string | null; amount: string; currency: string; clientPurchaseOrderId: string | null }>;
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

  async function issueAndDownload() {
    setIssuing(true); setMessage("");
    const response = await fetch("/api/client-invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ episodeId, clientPoOverrunReason: clientPoOverrunReason || undefined }) });
    const body = await response.json().catch(() => null);
    setIssuing(false);
    if (!response.ok) { const error = body?.error ?? "Could not issue this invoice."; setMessage(error); setNeedsOverrunReason(error.toLowerCase().includes("overrun") || error.toLowerCase().includes("exceeded")); return; }
    router.refresh();
    window.location.assign(`/api/client-invoices/${body.id}/pdf`);
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
    {needsOverrunReason && <div className="border-t border-[#f0e1d8] bg-[#fffaf6] px-5 py-3"><label className="block text-xs font-semibold text-[#8a5e45]">Client PO overrun reason<textarea value={clientPoOverrunReason} onChange={(event) => setClientPoOverrunReason(event.target.value)} rows={2} className="mt-1.5 block w-full rounded-md border border-[#dfc7bc] bg-white px-3 py-2 text-sm text-[#424a46]" placeholder="Record the approved scope change or client authorisation before issuing." /></label></div>}
    {readiness.invoices.length > 0 && <div className="border-t border-[#efeeea]"><div className="px-5 py-3 text-xs font-semibold text-[#59635e]">Issued invoices</div><div className="divide-y divide-[#efeeea]">{readiness.invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium text-[#39423e]">{invoice.invoiceNumber}</p><p className="mt-1 text-xs text-[#858a87]">Issued {formatDate(invoice.invoiceDate)} · Due {formatDate(invoice.dueDate)} · {invoice.currency} {Number(invoice.totalAmount).toFixed(2)}</p>{invoice.exportBlockedReason && <p className="mt-1 text-xs text-[#a35e41]">PDF export blocked · {invoice.exportBlockedReason}</p>}</div>{invoice.status === "void" ? <span className="text-xs font-semibold text-[#a65f42]">Void</span> : invoice.exportBlockedReason ? <span className="text-xs font-semibold text-[#a35e41]">Export locked</span> : <a href={`/api/client-invoices/${invoice.id}/pdf`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dce5df] bg-white px-3 text-xs font-semibold text-[#45675d] transition-colors hover:bg-[#f3f7f4]"><Download size={14} /> PDF</a>}</div>)}</div></div>}
    {message && <p role="alert" className="border-t border-[#f0e1d8] px-5 py-3 text-xs text-[#a65f42]">{message}</p>}
  </section>;
}

function Status({ label, ok, detail }: { label: string; ok: boolean; detail: string }) { return <div className="px-5 py-4"><div className={`flex items-center gap-2 text-xs font-semibold ${ok ? "text-[#4f7767]" : "text-[#a65f42]"}`}>{ok ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}{label}</div><p className="mt-2 text-xs leading-5 text-[#747c77]">{detail}</p></div>; }
function formatDate(value: string) { const [year, month, day] = value.split("-"); return year && month && day ? `${day}/${month}/${year}` : value; }
