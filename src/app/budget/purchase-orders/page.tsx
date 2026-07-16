import { AlertTriangle, ArrowRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { listCrmCompanyOptions } from "@/server/data/crm";
import { listEpisodes } from "@/server/data/episodes";
import { listActivePurchaseOrders } from "@/server/data/purchase-orders";
import { listShowOptions } from "@/server/data/shows";

export default async function PurchaseOrdersPage() {
  if (!(await can("manage_budget"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const [orders, companies, shows, episodes] = await Promise.all([
    listActivePurchaseOrders(), listCrmCompanyOptions(context.organization.organizationId), listShowOptions(context.organization.organizationId), listEpisodes(context.organization.organizationId),
  ]);
  const vendors = companies.filter((company) => company.type === "vendor");
  const expired = orders.filter((order) => order.expiryDate && new Date(order.expiryDate) < startOfToday() && order.status === "approved").length;
  const overrun = orders.filter((order) => order.remainingAmount < 0 || order.varianceAmount > 0).length;
  const active = orders.filter((order) => order.status === "approved").length;
  const formOptions = { currency: context.organization.currency, vendors, shows, episodes: episodes.map((episode) => ({ id: episode.id, showId: episode.showId, showTitle: episode.showTitle, number: episode.number, title: episode.title })) };

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><Link href="/budget" className="text-xs font-semibold text-[#58756b]">← Budget portfolio</Link><p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">External supplier authorisation</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Purchase Orders</h1><p className="mt-1 text-sm text-[#747977]">Authorised vendor spend, live commitments, actual supplier costs, and remaining headroom.</p></div><PurchaseOrderForm {...formOptions}/></header>
    <section className="grid gap-3 sm:grid-cols-3"><Metric label="Active POs" value={active} detail="Approved and open"/><Metric label="Over-committed" value={overrun} detail={overrun ? "Needs budget attention" : "Within authorised value"} warning={overrun > 0}/><Metric label="Expired" value={expired} detail={expired ? "Still open past expiry" : "No expiry exceptions"} warning={expired > 0}/></section>
    <section className="panel overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-[#ebeae6] px-5 py-4"><div><h2 className="text-sm font-semibold text-[#353b39]">PO register</h2><p className="mt-1 text-xs text-[#737b77]">Values are live from approved commitments and recorded supplier invoices.</p></div><span className="text-xs font-medium text-[#77807b]">{orders.length} total</span></div>
      {!orders.length ? <div className="px-5 py-14 text-center"><ClipboardList size={22} className="mx-auto text-[#9aa19d]"/><p className="mt-3 text-sm font-medium text-[#56615c]">No purchase orders yet</p><p className="mt-1 text-xs text-[#858a87]">Create a draft when external vendor spend needs authorisation.</p></div> : <div className="overflow-x-auto"><div className="min-w-[1060px]"><div className="grid grid-cols-[130px_minmax(180px,1.2fr)_180px_180px_110px_110px_110px_110px_96px_32px] gap-3 bg-[#f5f5f1] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#747c77]"><span>Status</span><span>PO / vendor</span><span>Show / episode</span><span>Expiry</span><span>Authorised</span><span>Committed</span><span>Actual</span><span>Remaining</span><span>Attention</span><span aria-hidden/></div><div className="divide-y divide-[#efeeea]">{orders.map((order) => <Link key={order.id} href={`/budget/purchase-orders/${order.id}`} className="grid grid-cols-[130px_minmax(180px,1.2fr)_180px_180px_110px_110px_110px_110px_96px_32px] items-center gap-3 px-5 py-4 text-sm transition-colors hover:bg-[#f8faf7]"><span><Status status={order.status}/></span><div className="min-w-0"><p className="truncate font-semibold text-[#37413d]">{order.poNumber}</p><p className="mt-1 truncate text-xs text-[#858a87]">{order.vendorName ?? "Vendor unavailable"}</p></div><div className="min-w-0 text-xs text-[#5f6964]"><p className="truncate">{order.showTitle ?? "All shows"}</p><p className="mt-1 truncate text-[#858a87]">{order.episodeTitle ? `E${String(order.episodeNumber ?? 0).padStart(2, "0")} ${order.episodeTitle}` : "No specific episode"}</p></div><p className={`text-xs ${isExpired(order.expiryDate, order.status) ? "font-semibold text-[#a35e41]" : "text-[#5f6964]"}`}>{order.expiryDate ? formatDate(order.expiryDate) : "No expiry"}</p><Money value={order.authorisedAmount} currency={order.currency}/><Money value={order.committedAmount} currency={order.currency}/><Money value={order.actualInvoicedAmount} currency={order.currency}/><Money value={order.remainingAmount} currency={order.currency} warning={order.remainingAmount < 0}/><Attention order={order}/><ArrowRight size={16} className="text-[#8b918d]"/></Link>)}</div></div></div>}</section>
  </div>;
}

function Metric({ label, value, detail, warning = false }: { label: string; value: number; detail: string; warning?: boolean }) { return <div className="panel p-4"><div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[.08em] ${warning ? "text-[#a35e41]" : "text-[#76807b]"}`}>{warning && <AlertTriangle size={15}/>} {label}</div><p className="mt-3 text-xl font-semibold tracking-[-.035em] text-[#343d39]">{value}</p><p className="mt-1 text-xs text-[#858a87]">{detail}</p></div>; }
function Status({ status }: { status: string }) { const styles = status === "approved" ? "bg-[#eaf3ed] text-[#4e7665]" : status === "closed" ? "bg-[#e8edf0] text-[#52636b]" : status === "cancelled" ? "bg-[#f5e9e5] text-[#a35e41]" : "bg-[#f2f0e9] text-[#6d736f]"; return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${styles}`}>{status}</span>; }
function Money({ value, currency, warning = false }: { value: number; currency: string; warning?: boolean }) { return <p className={`text-sm font-medium ${warning ? "text-[#a35e41]" : "text-[#4d5752]"}`}>{money(value, currency)}</p>; }
function Attention({ order }: { order: { remainingAmount: number; varianceAmount: number; expiryDate: string | null; status: string } }) { if (order.remainingAmount < 0) return <span className="text-xs font-semibold text-[#a35e41]">Over-committed</span>; if (order.varianceAmount > 0) return <span className="text-xs font-semibold text-[#a35e41]">Invoice overrun</span>; if (isExpired(order.expiryDate, order.status)) return <span className="text-xs font-semibold text-[#a35e41]">Expired</span>; return <span className="text-xs text-[#668077]">On track</span>; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
function formatDate(value: string | Date) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)); }
function startOfToday() { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }
function isExpired(value: string | Date | null, status: string) { return Boolean(value && status === "approved" && new Date(value) < startOfToday()); }
