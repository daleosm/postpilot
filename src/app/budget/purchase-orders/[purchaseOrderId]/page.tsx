import { AlertTriangle, ArrowLeft, ExternalLink, FileClock, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PurchaseOrderActions } from "@/components/purchase-order-actions";
import { PurchaseOrderActualCostForm } from "@/components/purchase-order-actual-cost-form";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { listCrmCompanyOptions } from "@/server/data/crm";
import { listEpisodes } from "@/server/data/episodes";
import { getActivePurchaseOrderDetail } from "@/server/data/purchase-orders";
import { listShowOptions } from "@/server/data/shows";

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ purchaseOrderId: string }> }) {
  if (!(await can("manage_budget"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) redirect("/");
  const { purchaseOrderId } = await params;
  const [order, companies, shows, episodes, mayApprove] = await Promise.all([getActivePurchaseOrderDetail(purchaseOrderId), listCrmCompanyOptions(context.organization.organizationId), listShowOptions(context.organization.organizationId), listEpisodes(context.organization.organizationId), can("approve_budget_overruns")]);
  if (!order) notFound();
  const formOptions = { currency: context.organization.currency, vendors: companies.filter((company) => company.type === "vendor"), shows, episodes: episodes.map((episode) => ({ id: episode.id, showId: episode.showId, showTitle: episode.showTitle, number: episode.number, title: episode.title })) };
  const expiry = expiryState(order.expiryDate, order.status);
  const isOverCommitted = order.remainingAmount < 0;
  return <div className="space-y-5"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><Link href="/budget/purchase-orders" className="inline-flex items-center gap-1 text-xs font-semibold text-[#58756b]"><ArrowLeft size={14}/> Purchase Orders</Link><p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">{statusLabel(order.status)} vendor authorisation</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">{order.poNumber}</h1><p className="mt-1 text-sm text-[#747977]">{order.vendorName ?? "Vendor"} · {order.showTitle ?? "All shows"}{order.episodeTitle ? ` · E${String(order.episodeNumber ?? 0).padStart(2, "0")} ${order.episodeTitle}` : ""}</p></div><div className="flex flex-wrap items-center gap-2">{order.status === "draft" && <PurchaseOrderForm {...formOptions} purchaseOrder={order}/>}<PurchaseOrderActualCostForm purchaseOrderId={order.id} status={order.status} currency={order.currency} episodeId={order.episodeId} showId={order.showId} episodes={formOptions.episodes}/><PurchaseOrderActions purchaseOrderId={order.id} status={order.status} mayApprove={mayApprove}/></div></header>
    {(expiry || isOverCommitted) && <section role="alert" className="flex gap-3 rounded-xl border border-[#efd8cf] bg-[#fff7f3] px-4 py-3 text-sm text-[#8b4f38]"><AlertTriangle size={17} className="mt-0.5 shrink-0"/><div><p className="font-semibold">PO needs attention</p><p className="mt-1 text-xs leading-5">{[isOverCommitted ? `Committed value exceeds the authorised amount by ${money(Math.abs(order.remainingAmount), order.currency)}.` : null, expiry?.message].filter(Boolean).join(" ")}</p></div></section>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Authorised" value={money(order.authorisedAmount, order.currency)}/><Metric label="Committed" value={money(order.committedAmount, order.currency)}/><Metric label="Actual invoiced" value={money(order.actualInvoicedAmount, order.currency)}/><Metric label="Remaining" value={money(order.remainingAmount, order.currency)} warning={isOverCommitted}/><Metric label="Variance" value={`${order.varianceAmount > 0 ? "+" : ""}${money(order.varianceAmount, order.currency)}`} warning={order.varianceAmount > 0}/></section>
    <section className="panel grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_260px]"><div><h2 className="text-sm font-semibold text-[#353b39]">Authorisation scope</h2>{order.notes ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#5f6964]">{order.notes}</p> : <p className="mt-2 text-sm text-[#858a87]">No internal authorisation note.</p>}{order.externalDocumentUrl && <a className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#58756b]" href={order.externalDocumentUrl} target="_blank" rel="noreferrer">Open supporting document <ExternalLink size={14}/></a>}</div><dl className="grid gap-3 text-sm"><Fact label="Status" value={statusLabel(order.status)}/><Fact label="Issue date" value={date(order.issueDate)}/><Fact label="Expiry date" value={date(order.expiryDate)}/><Fact label="Currency" value={order.currency}/></dl></section>
    <section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-4"><ReceiptText size={16} className="text-[#59756c]"/><div><h2 className="text-sm font-semibold text-[#353b39]">Allocation ledger</h2><p className="mt-1 text-xs text-[#737b77]">Committed value and actual supplier invoices are kept separate for live budget reporting.</p></div></div>{!order.allocations.length ? <Empty text="No commitments or supplier invoices have been allocated to this PO yet."/> : <div className="divide-y divide-[#efeeea]">{order.allocations.map((allocation) => <div id={`allocation-${allocation.id}`} key={allocation.id} className="grid gap-3 scroll-mt-5 px-5 py-4 sm:grid-cols-[130px_minmax(0,1fr)_130px_130px] sm:items-center"><div><p className="text-sm font-medium text-[#3d4642]">{allocationLabel(allocation.allocationType)}</p><p className="mt-1 text-xs text-[#858a87]">{date(allocation.allocationDate)}</p></div><div className="min-w-0"><p className="truncate text-sm text-[#525c57]">{allocation.description ?? "No description"}</p><p className="mt-1 truncate text-xs text-[#858a87]">{allocation.reference ?? "No reference"}</p>{allocation.externalDocumentUrl && <a href={allocation.externalDocumentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#58756b] hover:underline">Supporting document <ExternalLink size={12}/></a>}</div><p className="text-sm font-semibold text-[#4d5752]">{money(Number(allocation.amount), order.currency)}</p><p className="text-xs text-[#77807b]">{allocation.createdAt ? `Recorded ${date(allocation.createdAt)}` : "Recorded"}</p></div>)}</div>}</section>
    <section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-4"><FileClock size={16} className="text-[#59756c]"/><div><h2 className="text-sm font-semibold text-[#353b39]">Activity</h2><p className="mt-1 text-xs text-[#737b77]">PO lifecycle and authorised overrun events.</p></div></div>{!order.activity.length ? <Empty text="No activity has been recorded for this PO."/> : <div className="divide-y divide-[#efeeea]">{order.activity.map((event) => <div key={event.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-[#4d5752]">{activityLabel(event.action)}</p><p className="mt-1 text-xs text-[#858a87]">{event.actorName ?? "System"}</p></div><p className="text-xs text-[#77807b]">{date(event.createdAt)}</p></div>)}</div>}</section>
  </div>;
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <div className="panel p-4"><p className={`text-xs font-semibold uppercase tracking-[.08em] ${warning ? "text-[#a35e41]" : "text-[#76807b]"}`}>{label}</p><p className={`mt-3 text-xl font-semibold tracking-[-.035em] ${warning ? "text-[#a35e41]" : "text-[#343d39]"}`}>{value}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 border-b border-[#efeeea] pb-2 last:border-0"><dt className="text-[#858a87]">{label}</dt><dd className="text-right font-medium capitalize text-[#4d5752]">{value}</dd></div>; }
function Empty({ text }: { text: string }) { return <p className="px-5 py-12 text-center text-sm text-[#858a87]">{text}</p>; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
function date(value: string | Date | null | undefined) { return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }
function statusLabel(status: string) { return status.replaceAll("_", " "); }
function allocationLabel(type: string) { return type === "work_order" ? "Work order" : type === "budget_line" ? "Budget line" : "Vendor invoice"; }
function activityLabel(action: string) { return action.replace(/^purchase_order\./, "PO ").replaceAll("_", " "); }
function expiryState(value: string | Date | null, status: string) {
  if (!value || status !== "approved") return null;
  const expiry = new Date(value); const today = new Date();
  expiry.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0);
  const days = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { message: `This PO expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago.` };
  if (days <= 14) return { message: `This PO expires in ${days} day${days === 1 ? "" : "s"}.` };
  return null;
}
