import Link from "next/link";
import { AlertTriangle, Building2, CalendarClock, ContactRound, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";

import { CrmAccountDirectory } from "@/components/crm-account-directory";
import { CrmCreateDialogs } from "@/components/crm-create-dialogs";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { getCrmData } from "@/server/data/crm";

export default async function CrmPage() {
  const mayManageShows = await can("manage_shows");
  if (!mayManageShows && !(await can("manage_budget"))) redirect("/");
  const context = await getActiveOrganizationContext();
  const data = context?.organization ? await getCrmData(context.organization.organizationId) : emptyData();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const accounts = data.companies.map((company) => {
    return { id: company.id, name: company.name, type: company.type, accountStatus: company.accountStatus, bookingClearance: company.bookingClearance, ownerName: data.owners.find((owner) => owner.id === company.accountOwnerId)?.name ?? null, activeShowCount: data.showLinks.filter((show) => show.clientCompanyId === company.id || show.productionCompanyId === company.id).length, contactCount: data.contacts.filter((contact) => contact.companyId === company.id).length, nextAction: company.nextAction, nextActionDueAt: company.nextActionDueAt, currency: company.currency };
  });
  const followUps = accounts.filter((account) => account.nextAction && account.nextActionDueAt && new Date(account.nextActionDueAt) <= today).slice(0, 5);
  const contactGaps = data.companies.filter((company) => company.type !== "vendor").map((company) => ({ company, missing: ["creative_approval", "technical_delivery", "finance"].filter((type) => !data.contacts.some((contact) => contact.companyId === company.id && contact.contactType === type)) })).filter((item) => item.missing.length).slice(0, 5);
  const vendorAttention = data.workOrders.filter((workOrder) => workOrder.vendorCompanyId && !["complete", "cancelled"].includes(workOrder.status)).slice(0, 5);

  return <div className="space-y-5"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[.12em] text-[#7c827f]">Commercial relationships · {context?.organization?.organizationName ?? "Workspace"}</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-.045em] text-[#202524]">Clients & vendors</h1><p className="mt-1 text-sm text-[#747977]">Account ownership, operational contacts, booking clearance, and commercial context.</p></div><div className="flex flex-wrap gap-2"><CrmCreateDialogs companies={data.companies.map((company) => ({ id: company.id, name: company.name, type: company.type }))}/></div></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Metric icon={<Building2 size={16}/>} label="Accounts" value={accounts.length} detail="Active directory"/><Metric icon={<CalendarClock size={16}/>} label="Follow-ups due" value={followUps.length} detail="Relationship actions" warning={followUps.length > 0}/><Metric icon={<ContactRound size={16}/>} label="Contact gaps" value={contactGaps.length} detail="External routes to complete" warning={contactGaps.length > 0}/></section>
    <section className="grid gap-4 xl:grid-cols-2"><Attention title="Accounts needing follow-up" icon={<CalendarClock size={16}/>} empty="No account follow-ups are due." rows={followUps.map((account) => ({ id: account.id, href: `/crm/accounts/${account.id}`, title: account.name, detail: `${account.nextAction} · due ${formatDate(account.nextActionDueAt!)}` }))}/><Attention title="Contact gaps" icon={<ContactRound size={16}/>} empty="Every client-side account has the core contacts." rows={contactGaps.map((item) => ({ id: item.company.id, href: `/crm/accounts/${item.company.id}`, title: item.company.name, detail: `Missing ${item.missing.map(label).join(", ")}` }))}/></section>
    <section><Attention title="Vendor attention" icon={<UsersRound size={16}/>} empty="No active vendor work needs attention." rows={vendorAttention.map((workOrder) => ({ id: workOrder.id, href: "/crm", title: workOrder.title, detail: `${workOrder.episodeTitle ? `E${String(workOrder.episodeNumber).padStart(2, "0")} ${workOrder.episodeTitle}` : "Unassigned"} · ${workOrder.status.replaceAll("_", " ")}` }))}/></section>
    <CrmAccountDirectory accounts={accounts}/>
  </div>;
}

function Attention({ title, icon, rows, empty }: { title: string; icon: React.ReactNode; rows: Array<{ id: string; href: string; title: string; detail: string }>; empty: string }) { return <section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-3 text-sm font-semibold text-[#3e4743]">{icon}{title}</div><div className="divide-y divide-[#efeeea]">{rows.map((row) => <Link key={row.id} href={row.href} className="block px-5 py-3 hover:bg-[#fafbf9]"><p className="text-sm font-medium text-[#3d4642]">{row.title}</p><p className="mt-1 text-xs text-[#7d837f]">{row.detail}</p></Link>)}{!rows.length && <p className="px-5 py-8 text-sm text-[#858a87]">{empty}</p>}</div></section>; }
function Metric({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: number; detail: string; warning?: boolean }) { return <div className="panel flex items-center gap-3 p-4"><span className={`rounded-lg p-2 ${warning ? "bg-[#f6e9e2] text-[#a15e42]" : "bg-[#eaf0ec] text-[#58736a]"}`}>{warning ? <AlertTriangle size={16}/> : icon}</span><div><p className="text-lg font-semibold text-[#303734]">{value}</p><p className="text-xs text-[#7c827f]">{label} · {detail}</p></div></div>; }
function label(value: string) { return value.replaceAll("_", " "); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value)); }
function emptyData() { return { companies: [], contacts: [], rateCards: [], vendorInvoices: [], workOrders: [], showOptions: [], episodeOptions: [], showLinks: [], owners: [] }; }
