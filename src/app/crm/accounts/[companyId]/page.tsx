import Link from "next/link";
import { ArrowLeft, CalendarClock, ContactRound, FileText, Landmark, ReceiptText, Tags, UserRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { CrmAccountDetailsForm } from "@/components/crm-account-details-form";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { getCrmAccount } from "@/server/data/crm";

export default async function CrmAccountPage({ params }: { params: Promise<{ companyId: string }> }) {
  if (!(await can("manage_shows")) && !(await can("manage_budget"))) redirect("/");
  const context = await getActiveOrganizationContext();
  if (!context?.organization) notFound();
  const { companyId } = await params;
  const data = await getCrmAccount(context.organization.organizationId, companyId);
  if (!data) notFound();
  const { company } = data;
  const owner = data.owners.find((person) => person.id === company.accountOwnerId);
  const isVendor = company.type === "vendor";

  return <div className="space-y-5">
    <Link href="/crm" className="flex w-fit items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14}/> Clients & vendors</Link>
    <header className="panel flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-start">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase tracking-[.1em] text-[#7c827f]">{company.type.replaceAll("_", " ")}</p><AccountStatus status={company.accountStatus} /></div><h1 className="mt-2 truncate text-[27px] font-semibold tracking-[-.045em] text-[#202524]">{company.name}</h1><p className="mt-1 text-sm text-[#747977]">{company.address ?? "Address not set"} · {company.paymentTermsDays ? `Net ${company.paymentTermsDays}` : "Terms not set"} · {company.currency}</p></div>
      <CrmAccountDetailsForm account={company} owners={data.owners} />
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<ReceiptText size={16}/>} label="Open POs" value={String(data.financials.openPurchaseOrderCount)} detail="Current authorisations" />
      <Metric icon={<Landmark size={16}/>} label="Committed cost" value={money(data.financials.committedCost, company.currency)} detail="Vendor commitments" />
      <Metric icon={<ReceiptText size={16}/>} label={isVendor ? "Vendor invoiced" : "Client invoiced"} value={money(data.financials.invoicedAmount, company.currency)} detail={isVendor ? "Supplier invoice register" : "Client billables"} />
      <Metric icon={<Landmark size={16}/>} label="Remaining authorised" value={money(data.financials.remainingAuthorisedSpend, company.currency)} detail="Open PO balance" warning={data.financials.remainingAuthorisedSpend < 0} />
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.9fr)]">
      <Panel title="Account profile" icon={<UserRound size={16}/> }>
        <div className="grid divide-y divide-[#efeeea] sm:grid-cols-2 sm:divide-x sm:divide-y-0"><ProfileItem label="Account owner" value={owner ? `${owner.name} · ${owner.role.replaceAll("_", " ")}` : "Unassigned"}/><ProfileItem label="Finance email" value={company.financeEmail ?? company.billingEmail ?? "Not set"}/><ProfileItem label="Service category" value={company.serviceCategory ?? (isVendor ? "Not set" : "Not applicable")}/><ProfileItem label="Supplier status" value={isVendor ? (company.isPreferredSupplier ? "Preferred supplier" : "Approved supplier") : "—"}/></div>
      </Panel>
      <Panel title="Next action" icon={<CalendarClock size={16}/> }>
        <div className="px-5 py-4"><p className="text-sm font-medium text-[#3d4642]">{company.nextAction ?? "No follow-up scheduled"}</p><p className="mt-1 text-xs text-[#7d837f]">{company.nextActionDueAt ? `Due ${formatDate(company.nextActionDueAt)}` : "Set an owner and due date to keep the relationship moving."}</p></div>
      </Panel>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <Panel title="Key contacts" icon={<ContactRound size={16}/> }>
        <div className="divide-y divide-[#efeeea]">{data.contacts.map((contact) => <div key={contact.id} className="flex flex-col justify-between gap-2 px-5 py-3 sm:flex-row sm:items-center"><div className="min-w-0"><p className="text-sm font-medium text-[#3d4642]">{contact.name}{contact.isPrimary && <span className="ml-2 rounded bg-[#e5eee8] px-1.5 py-0.5 text-[10px] font-semibold text-[#477263]">Primary</span>}</p><p className="mt-1 text-xs capitalize text-[#7d837f]">{contact.contactType.replaceAll("_", " ")} · {contact.title ?? "Contact"}</p></div><p className="text-xs text-[#68716d]">{contact.email ?? contact.phone ?? "No contact details"}</p></div>)}{!data.contacts.length && <Empty message="No operational contacts recorded." />}</div>
      </Panel>
      <Panel title="Rate cards & services" icon={<Tags size={16}/> }>
        <div className="divide-y divide-[#efeeea]">{data.rateCards.map((rateCard) => <div key={rateCard.id} className="flex items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-[#3d4642]">{rateCard.name}</p><p className="mt-1 text-xs text-[#7d837f]">{rateCard.itemCount} service {rateCard.itemCount === 1 ? "rate" : "rates"}{rateCard.effectiveFrom ? ` · From ${formatDate(rateCard.effectiveFrom)}` : ""}</p></div><span className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold ${rateCard.isActive ? "bg-[#e5eee8] text-[#477263]" : "bg-[#f1f0ed] text-[#767c78]"}`}>{rateCard.isActive ? "Active" : "Inactive"}</span></div>)}{!data.rateCards.length && <Empty message="No account-specific rate cards." />}</div>
      </Panel>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <ShowList title="Active shows" shows={data.activeShows} empty="No active shows for this account." />
      <ShowList title="Past shows" shows={data.pastShows} empty="No completed or archived shows for this account." muted />
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <Panel title="Purchase orders" icon={<Landmark size={16}/> }>
        <div className="divide-y divide-[#efeeea]">{data.purchaseOrders.map((purchaseOrder) => <Link key={purchaseOrder.id} href={`/crm/purchase-orders/${purchaseOrder.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[#fafbf9]"><div className="min-w-0"><p className="text-sm font-medium text-[#3d4642]">{purchaseOrder.poNumber}</p><p className="mt-1 truncate text-xs text-[#7d837f]">{purchaseOrder.showTitle ?? "Unallocated"} · {purchaseOrder.kind.replaceAll("_", " ")}</p></div><p className="shrink-0 text-right text-xs text-[#68716d]">{money(Number(purchaseOrder.amount ?? 0) - Number(purchaseOrder.consumedAmount ?? 0), purchaseOrder.currency)}<span className="mt-1 block text-[#929793]">remaining</span></p></Link>)}{!data.purchaseOrders.length && <Empty message="No purchase orders for this account." />}</div>
      </Panel>
      <Panel title="Internal account notes" icon={<FileText size={16}/> }>
        <div className="px-5 py-4"><p className="whitespace-pre-wrap text-sm leading-6 text-[#56615c]">{company.notes ?? "No internal account notes yet."}</p></div>
      </Panel>
    </section>

    {isVendor && <Panel title="Vendor operations" icon={<ReceiptText size={16}/> }><div className="grid divide-y divide-[#efeeea] md:grid-cols-2 md:divide-x md:divide-y-0"><Rows title="Active work orders" empty="No active vendor work orders." rows={data.workOrders.filter((item) => !["complete", "cancelled"].includes(item.status)).map((item) => ({ id: item.id, primary: item.title, secondary: `E${String(item.episodeNumber).padStart(2, "0")} ${item.episodeTitle} · ${item.status}` }))}/><Rows title="Vendor invoices" empty="No vendor invoices." rows={data.invoices.map((item) => ({ id: item.id, primary: item.invoiceNumber, secondary: `${money(Number(item.amount), item.currency)} · ${item.status}` }))}/></div></Panel>}

    <Panel title="Recent commercial activity" icon={<CalendarClock size={16}/> }>
      <div className="divide-y divide-[#efeeea]">{data.activities.map((activity) => <div key={activity.id} className="flex justify-between gap-4 px-5 py-3"><div className="min-w-0"><p className="text-sm font-medium text-[#46504b]">{activity.action.replaceAll(".", " ").replaceAll("_", " ")}</p><p className="mt-1 truncate text-xs text-[#7d837f]">{activity.detail}</p></div><time className="shrink-0 text-xs text-[#858a87]" dateTime={activity.createdAt.toISOString()}>{formatDateTime(activity.createdAt)}</time></div>)}{!data.activities.length && <Empty message="No commercial activity recorded for this account yet." />}</div>
    </Panel>
  </div>;
}

function AccountStatus({ status }: { status: string }) { return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold capitalize ${status === "active" ? "bg-[#e5eee8] text-[#477263]" : status === "on_hold" ? "bg-[#f6ebde] text-[#9a613f]" : "bg-[#f1f0ed] text-[#707672]"}`}>{status.replaceAll("_", " ")}</span>; }
function Metric({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warning?: boolean }) { return <div className="panel p-4"><div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[.08em] ${warning ? "text-[#a65f42]" : "text-[#76807b]"}`}>{icon}{label}</div><p className={`mt-3 text-xl font-semibold tracking-[-.035em] ${warning ? "text-[#a65f42]" : "text-[#343d39]"}`}>{value}</p><p className="mt-1 text-xs text-[#858a87]">{detail}</p></div>; }
function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-3 text-sm font-semibold text-[#3e4743]">{icon}{title}</div>{children}</section>; }
function ProfileItem({ label, value }: { label: string; value: string }) { return <div className="px-5 py-4"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#858a87]">{label}</p><p className="mt-1 text-sm text-[#4c5651]">{value}</p></div>; }
function Empty({ message }: { message: string }) { return <p className="px-5 py-8 text-sm text-[#858a87]">{message}</p>; }
function Rows({ title, empty, rows }: { title: string; empty: string; rows: Array<{ id: string; primary: string; secondary: string }> }) { return <div><div className="px-5 py-3 text-sm font-semibold text-[#3e4743]">{title}</div><div className="divide-y divide-[#efeeea]">{rows.map((row) => <div key={row.id} className="px-5 py-3"><p className="text-sm font-medium text-[#3d4642]">{row.primary}</p><p className="mt-1 text-xs text-[#7d837f]">{row.secondary}</p></div>)}{!rows.length && <Empty message={empty}/>}</div></div>; }
function ShowList({ title, shows, empty, muted = false }: { title: string; shows: Array<{ id: string; title: string; code: string; network: string | null; activeEpisodeCount: number }>; empty: string; muted?: boolean }) { return <Panel title={title} icon={<Tags size={16}/> }><div className="divide-y divide-[#efeeea]">{shows.map((show) => <Link key={show.id} href={`/shows/${show.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[#fafbf9]"><div className="min-w-0"><p className="truncate text-sm font-medium text-[#3d4642]">{show.code} · {show.title}</p><p className="mt-1 truncate text-xs text-[#7d837f]">{show.network ?? "Independent"}</p></div>{!muted && <span className="shrink-0 rounded bg-[#e5eee8] px-2 py-1 text-[10px] font-semibold text-[#477263]">{show.activeEpisodeCount} active eps</span>}</Link>)}{!shows.length && <Empty message={empty}/>}</div></Panel>; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
function formatDate(value: string | Date) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)); }
function formatDateTime(value: Date) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(value); }
