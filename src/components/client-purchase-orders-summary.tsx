import Link from "next/link";
import { Landmark } from "lucide-react";

import type { ClientPurchaseOrderCommercialLinks, ClientPurchaseOrderSummary } from "@/server/data/client-purchase-orders";

type Props = {
  orders: ClientPurchaseOrderSummary[];
  links: ClientPurchaseOrderCommercialLinks;
  scope: "account" | "show";
};

export function ClientPurchaseOrdersSummary({ orders, links, scope }: Props) {
  const active = orders.filter((order) => order.status === "active");
  const closed = orders.filter((order) => order.status === "closed");
  const title = scope === "account" ? "Client POs" : "Client POs for this show";
  const detail = scope === "account"
    ? "Client billing authorisations, separate from vendor procurement and supplier spend."
    : "Billing authorisations attached to this show or one of its episodes. Vendor POs are not included.";

  return <section className="panel overflow-hidden">
    <div className="flex items-start gap-2 border-b border-[#ebeae6] px-5 py-3.5">
      <Landmark size={16} className="mt-0.5 shrink-0 text-[#58756b]" />
      <div className="min-w-0"><h2 className="text-sm font-semibold text-[#3e4743]">{title}</h2><p className="mt-0.5 text-xs text-[#737b77]">{detail}</p></div>
    </div>
    <ClientPoGroup label="Active POs" orders={active} links={links} empty="No active client POs for this scope." />
    <ClientPoGroup label="Closed POs" orders={closed} links={links} empty="No closed client POs for this scope." />
  </section>;
}

function ClientPoGroup({ label, orders, links, empty }: { label: string; orders: ClientPurchaseOrderSummary[]; links: ClientPurchaseOrderCommercialLinks; empty: string }) {
  return <div className="border-b border-[#efeeea] last:border-b-0">
    <div className="flex items-center justify-between px-5 py-3"><h3 className="text-sm font-semibold text-[#3e4743]">{label}</h3><span className="text-xs text-[#858a87]">{orders.length}</span></div>
    {!orders.length ? <p className="px-5 py-7 text-sm text-[#858a87]">{empty}</p> : <div className="overflow-x-auto"><div className="min-w-[940px]">
      <div className="grid grid-cols-[minmax(160px,1.05fr)_110px_110px_110px_110px_135px_minmax(210px,1.2fr)] gap-3 bg-[#fafaf8] px-5 py-2 text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e837f]"><span>PO</span><span>Authorised</span><span>Committed</span><span>Invoiced</span><span>Remaining</span><span>Expiry</span><span>Linked billing</span></div>
      {orders.map((order) => <ClientPoRow key={order.id} order={order} billables={links.billablesByPurchaseOrder[order.id] ?? []} invoices={links.invoicesByPurchaseOrder[order.id] ?? []} />)}
    </div></div>}
  </div>;
}

function ClientPoRow({ order, billables, invoices }: { order: ClientPurchaseOrderSummary; billables: ClientPurchaseOrderCommercialLinks["billablesByPurchaseOrder"][string]; invoices: ClientPurchaseOrderCommercialLinks["invoicesByPurchaseOrder"][string] }) {
  const expiry = expiryWarning(order.expiryDate, order.status);
  return <div className="grid grid-cols-[minmax(160px,1.05fr)_110px_110px_110px_110px_135px_minmax(210px,1.2fr)] items-start gap-3 border-t border-[#efeeea] px-5 py-3 text-sm">
    <div className="min-w-0"><Link href={`/budget/client-purchase-orders/${order.id}`} className="font-semibold text-[#58756b] hover:underline">{order.poNumber}</Link><p className="mt-1 truncate text-xs capitalize text-[#7d837f]">{order.status}{order.episodeTitle ? ` · E${String(order.episodeNumber ?? 0).padStart(2, "0")} ${order.episodeTitle}` : order.showTitle ? ` · ${order.showTitle}` : ""}</p></div>
    <Money value={order.authorisedAmount} currency={order.currency} /><Money value={order.committedToBillAmount} currency={order.currency} /><Money value={order.invoicedAmount} currency={order.currency} /><Money value={order.remainingAmount} currency={order.currency} warning={order.remainingAmount < 0} />
    <div className="text-xs text-[#5f6964]">{order.expiryDate ? formatDate(order.expiryDate) : "No expiry"}{expiry && <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${expiry === "expired" ? "bg-[#f9e7df] text-[#9f563c]" : "bg-[#f6ebde] text-[#9a613f]"}`}>{expiry === "expired" ? "Expired" : "Expires soon"}</span>}</div>
    <div className="min-w-0 text-xs text-[#56615c]">{billables.length || invoices.length ? <><p className="font-medium text-[#48534e]">{billables.length} billable{billables.length === 1 ? "" : "s"} · {invoices.length} invoice{invoices.length === 1 ? "" : "s"}</p>{billables.slice(0, 2).map((billable) => <p key={billable.id} className="mt-1 truncate">{billable.reference ?? billable.description ?? "Billable"} <span className="text-[#858a87]">({billable.status})</span></p>)}{invoices.slice(0, 2).map((invoice) => <p key={invoice.id} className="mt-1 truncate"><span className="font-medium">{invoice.invoiceNumber}</span> <span className="text-[#858a87]">({invoice.status})</span></p>)}</> : <span className="text-[#858a87]">No linked billables or invoices</span>}</div>
  </div>;
}

function Money({ value, currency, warning = false }: { value: number; currency: string; warning?: boolean }) { return <p className={warning ? "font-semibold text-[#a65f42]" : "text-[#4d5752]"}>{money(value, currency)}</p>; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)); }
function expiryWarning(expiryDate: string | null, status: string) { if (!expiryDate || status !== "active") return null; const days = Math.ceil((new Date(`${expiryDate}T00:00:00`).getTime() - new Date().getTime()) / 86_400_000); return days < 0 ? "expired" : days <= 30 ? "expiring" : null; }
