import Link from "next/link";
import { AlertTriangle, Building2, CalendarClock, ContactRound, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";

import { CrmAccountDirectory } from "@/components/crm-account-directory";
import { CrmCreateDialogs } from "@/components/crm-create-dialogs";
import { PageHeader } from "@/components/operations-ui";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function CrmPage() {
  const mayManageShows = await can("manage_shows");
  if (!mayManageShows && !(await can("manage_budget"))) redirect("/");
  const context = await getActiveOrganizationContext();
  const data = context?.organization ? await loadCrmData() : emptyData();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const accounts = data.companies.map((company) => {
    return { id: company.id, name: company.name, type: company.type, accountStatus: company.accountStatus, bookingClearance: company.bookingClearance, ownerName: data.owners.find((owner) => owner.id === company.accountOwnerId)?.name ?? null, activeShowCount: data.showLinks.filter((show) => show.clientCompanyId === company.id || show.productionCompanyId === company.id).length, contactCount: data.contacts.filter((contact) => contact.companyId === company.id).length, nextAction: company.nextAction, nextActionDueAt: company.nextActionDueAt, currency: company.currency };
  });
  const followUps = accounts.filter((account) => account.nextAction && account.nextActionDueAt && new Date(account.nextActionDueAt) <= today).slice(0, 5);
  const contactGaps = data.companies.filter((company) => company.type !== "vendor").map((company) => ({ company, missing: ["creative_approval", "technical_delivery", "finance"].filter((type) => !data.contacts.some((contact) => contact.companyId === company.id && contact.contactType === type)) })).filter((item) => item.missing.length).slice(0, 5);
  const vendorAttention = data.workOrders.filter((workOrder) => workOrder.vendorCompanyId && !["complete", "cancelled"].includes(workOrder.status)).slice(0, 5);

  return <div className="pp-page"><PageHeader eyebrow={`Commercial relationships · ${context?.organization?.organizationName ?? "Workspace"}`} title="Clients & vendors" description="Account ownership, operational contacts, booking clearance, and commercial context." metrics={[{ label: "Accounts", value: accounts.length }, { label: "Follow-ups", value: followUps.length, tone: followUps.length ? "warning" : "default" }, { label: "Contact gaps", value: contactGaps.length, tone: contactGaps.length ? "warning" : "success" }]} action={<CrmCreateDialogs companies={data.companies.map((company) => ({ id: company.id, name: company.name, type: company.type }))}/>} />
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

async function loadCrmData() {
  const data = await postpilotApiServerFetch<{
    companies: Array<{ id: string; name: string; type: string; account_status: string; booking_clearance: string; account_owner_id: string | null; next_action: string | null; next_action_due_at: string | null; currency: string }>;
    contacts: Array<{ id: string; company_id: string; name: string; title: string | null; email: string | null; phone: string | null; contact_type: string; is_primary: boolean; company_name: string | null; company_type: string | null }>;
    show_links: Array<{ id: string; client_company_id: string | null; production_company_id: string | null }>;
    owners: Array<{ id: string; name: string }>;
    work_orders: Array<{ id: string; vendor_company_id: string | null; title: string; status: string; due_at: string | null; episode_title: string | null; episode_number: number | null }>;
  }>("/crm/workspace");
  return {
    companies: data.companies.map((company) => ({ id: company.id, name: company.name, type: company.type, accountStatus: company.account_status, bookingClearance: company.booking_clearance, accountOwnerId: company.account_owner_id, nextAction: company.next_action, nextActionDueAt: company.next_action_due_at, currency: company.currency })),
    contacts: data.contacts.map((contact) => ({ id: contact.id, companyId: contact.company_id, name: contact.name, title: contact.title, email: contact.email, phone: contact.phone, contactType: contact.contact_type, isPrimary: contact.is_primary, companyName: contact.company_name, companyType: contact.company_type })),
    showLinks: data.show_links.map((show) => ({ id: show.id, clientCompanyId: show.client_company_id, productionCompanyId: show.production_company_id })),
    owners: data.owners,
    workOrders: data.work_orders.map((workOrder) => ({ id: workOrder.id, vendorCompanyId: workOrder.vendor_company_id, title: workOrder.title, status: workOrder.status, dueAt: workOrder.due_at, episodeTitle: workOrder.episode_title, episodeNumber: workOrder.episode_number })),
    rateCards: [], vendorInvoices: [], showOptions: [], episodeOptions: [],
  };
}
