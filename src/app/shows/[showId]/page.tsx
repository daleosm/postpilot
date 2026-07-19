import Link from "next/link";
import { Activity, ArrowLeft, CalendarRange, Clapperboard, ContactRound, Truck, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";

import { ShowFormDialog } from "@/components/show-form-dialog";
import { EpisodeFormDialog } from "@/components/episode-form-dialog";
import { ClientPurchaseOrdersSummary } from "@/components/client-purchase-orders-summary";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getDemoCommandCenterData, getShowDeliverySummaryForOrganization, getShowWorkspace } from "@/server/data";
import { getClientPurchaseOrderCommercialLinksForOrganization, listClientPurchaseOrdersForShow } from "@/server/data/client-purchase-orders";

export default async function ShowDetailPage({ params }: { params: Promise<{ showId: string }> }) {
  const [mayManageShows, mayManageBudget, mayViewDelivery, organizationContext] = await Promise.all([can("manage_shows"), can("manage_budget"), Promise.all([can("manage_episode_manifests"), can("update_delivery_items"), can("confirm_delivery_receipt")]).then((permissions) => permissions.some(Boolean)), getActiveOrganizationContext()]);
  if (!mayManageShows || organizationContext?.organization?.role === "guest") notFound();
  const { showId } = await params;
  const data = await getShowDetail(showId);
  if (!data) notFound();
  const { show, seasons, episodes, team, people, contacts, activity } = data;
  const deliverySummary = mayViewDelivery && !isDebugDemoMode && organizationContext?.organization ? await getShowDeliverySummaryForOrganization(organizationContext.organization.organizationId, show.id) : null;
  const clientPurchaseOrders = mayManageBudget && !isDebugDemoMode && organizationContext?.organization
    ? await listClientPurchaseOrdersForShow(organizationContext.organization.organizationId, show.id)
    : [];
  const clientPurchaseOrderLinks = mayManageBudget && !isDebugDemoMode && organizationContext?.organization
    ? await getClientPurchaseOrderCommercialLinksForOrganization(organizationContext.organization.organizationId, clientPurchaseOrders.map((order) => order.id))
    : { billablesByPurchaseOrder: {}, invoicesByPurchaseOrder: {} };
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3"><Link href="/shows" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> All shows</Link><div className="flex items-center gap-2"><EpisodeFormDialog seasons={seasons.map((season) => ({ id: season.id, label: `${show.title} · Season ${season.number}` }))} people={people} defaultSeasonId={seasons[0]?.id} /><ShowFormDialog show={show} /></div></div>
    <header className="panel p-6"><div className="flex gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Clapperboard size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">{show.code} · {show.network ?? "Independent"}</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{show.title}</h1><p className="mt-1 text-sm text-[#777d79]">{show.productionCompany ?? "Post-production workspace"}</p></div></div></header>
    <section className="grid gap-5 xl:grid-cols-2"><Panel title="Seasons & episodes" icon={<CalendarRange size={16} />}><div className="divide-y divide-[#efeeea]">{seasons.map((season) => <div key={season.id} className="flex items-center justify-between px-5 py-3"><div><p className="text-sm font-medium text-[#3b423f]">Season {season.number}</p><p className="mt-0.5 text-xs text-[#858a87]">{season.activeCount} active of {season.episodeCount} episodes</p></div><Link href={`/episodes?season=${season.id}`} className="text-xs font-semibold text-[#58766e] hover:text-[#365f53] hover:underline">Open season <span aria-hidden>→</span></Link></div>)}</div></Panel><Panel title="Recent workflow completions" icon={<Activity size={16} />}><div className="divide-y divide-[#efeeea]">{activity.slice(0, 4).map((item) => <Link href={`/episodes/${item.episodeId}`} key={item.id} className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-[#fbfbf9]"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#e6eee8] text-[#527968]"><Activity size={13} /></span><div className="min-w-0"><p className="text-sm font-medium text-[#3d4542]">{workflowStageLabel(item.metadata)}</p><p className="mt-0.5 truncate text-xs text-[#6f7773]">S{item.seasonNumber} · E{String(item.episodeNumber).padStart(2, "0")} {item.episodeTitle}</p><p className="mt-1 text-[11px] text-[#969b98]">Completed {formatActivityDate(item.createdAt)}</p></div></Link>)}{!activity.length && <p className="px-5 py-8 text-center text-sm text-[#858a87]">No workflow stages have been completed for this show yet.</p>}</div></Panel></section>
    {deliverySummary && <Panel title="Delivery summary" icon={<Truck size={16} />}><div className="grid divide-y divide-[#efeeea] sm:grid-cols-4 sm:divide-x sm:divide-y-0"><div className="px-5 py-4"><p className="text-2xl font-semibold text-[#3d4943]">{deliverySummary.complete}/{deliverySummary.required}</p><p className="mt-1 text-xs text-[#78817c]">Required items confirmed</p></div><div className="px-5 py-4"><p className={`text-2xl font-semibold ${deliverySummary.blocked || deliverySummary.overdue ? "text-[#a45f43]" : "text-[#3d7160]"}`}>{deliverySummary.blocked + deliverySummary.overdue}</p><p className="mt-1 text-xs text-[#78817c]">Blocked or overdue</p></div><div className="px-5 py-4"><p className="text-2xl font-semibold text-[#3d4943]">{deliverySummary.receiptConfirmedCount}/{deliverySummary.episodeCount}</p><p className="mt-1 text-xs text-[#78817c]">Episodes with receipt</p></div><div className="px-5 py-4"><p className={`text-2xl font-semibold ${deliverySummary.profileNotApplied ? "text-[#986638]" : "text-[#3d7160]"}`}>{deliverySummary.profileNotApplied}</p><p className="mt-1 text-xs text-[#78817c]">Profile not applied</p></div></div><div className="border-t border-[#efeeea] px-5 py-3"><Link href="/deliveries" className="text-xs font-semibold text-[#4d766a] hover:underline">Open delivery register →</Link></div></Panel>}
    <Panel title="Episode team" icon={<UsersRound size={16} />}>{team.length ? <div className="grid gap-px bg-[#efeeea] sm:grid-cols-2 xl:grid-cols-3">{team.map((person) => <div key={person.id} className="min-w-0 bg-white px-5 py-4"><div className="flex items-start justify-between gap-3"><p className="truncate text-sm font-semibold text-[#464d49]">{person.name}</p><span className="shrink-0 rounded-full bg-[#f0f3f0] px-2 py-1 text-[10px] font-medium capitalize text-[#68746e]">{person.role.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-[#858a87]">{person.episodes.length} assigned episode{person.episodes.length === 1 ? "" : "s"}</p><div className="mt-3 flex flex-wrap gap-1.5">{person.episodes.map((episode) => <Link key={episode.id} href={`/episodes/${episode.id}`} className="rounded-md bg-[#edf2ee] px-2 py-1 text-[10px] font-medium text-[#4f6e64] transition hover:bg-[#e2ebe5]">S{episode.seasonNumber} · E{String(episode.number).padStart(2, "0")} {episode.title}</Link>)}</div></div>)}</div> : <p className="px-4 py-8 text-center text-sm text-[#858a87]">Assign people from each episode.</p>}</Panel>
    <Panel title="Show contacts" icon={<ContactRound size={16} />}><div className="grid divide-y divide-[#efeeea] md:grid-cols-2 md:divide-x md:divide-y-0">{contacts.map((contact) => <div key={contact.responsibility} className="px-5 py-3"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7c827f]">{contact.responsibility.replaceAll("_", " ")}</p><p className="mt-1 text-sm font-medium text-[#3d4542]">{contact.name}</p><p className="mt-1 text-xs text-[#858a87]">{contact.title ?? "Contact"} · {contact.companyName}</p><p className="mt-1 text-xs text-[#68716d]">{contact.email ?? contact.phone ?? "Contact details not set"}</p></div>)}{!contacts.length && <p className="px-5 py-8 text-sm text-[#858a87]">No show contacts assigned.</p>}</div></Panel>
    {mayManageBudget && <ClientPurchaseOrdersSummary orders={clientPurchaseOrders} links={clientPurchaseOrderLinks} scope="show" />}
    <Panel title="Episode board" icon={<Clapperboard size={16} />}><div className="divide-y divide-[#efeeea]">{episodes.map((episode) => <Link key={episode.id} href={`/episodes/${episode.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-[#fbfbf9]"><div className="min-w-0"><p className="truncate text-sm font-medium text-[#3b423f]">E{String(episode.number).padStart(2, "0")} · {episode.title}</p><p className="mt-0.5 truncate text-xs text-[#858a87]">{episode.workflowStage ?? "Workflow not configured"} · {episode.editorName ?? "Unassigned"}</p></div><WorkflowStateBadge status={episode.status} className="shrink-0" /></Link>)}</div></Panel>
  </div>;
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-3.5 text-sm font-semibold text-[#333a37]">{icon}{title}</div>{children}</section>; }

function workflowStageLabel(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || typeof (metadata as Record<string, unknown>).stage !== "string") return "Workflow stage completed";
  return `${(metadata as Record<string, string>).stage} completed`;
}

function formatActivityDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function getShowDetail(showId: string) {
  if (isDebugDemoMode) {
    const demo = getDemoCommandCenterData(); const show = demo.showRows.find((item) => item.id === showId); if (!show) return null;
    const episodes = demo.dashboard.episodes.filter((episode) => episode.showTitle === show.title).map((episode) => ({ ...episode, workflowStage: episode.status.replaceAll("_", " "), editorName: episode.showTitle === "Under Current" ? "Leah Morgan" : "James Liu" }));
    const people = demo.team.map((person) => ({ ...person, availability: "available", isActive: true }));
    const team = people.map((person) => ({ ...person, episodes: episodes.filter((episode) => episode.editorName === person.name).map((episode) => ({ id: episode.id, number: episode.number, title: episode.title, seasonNumber: episode.seasonNumber })) })).filter((person) => person.episodes.length);
    const activity = demo.dashboard.activity.filter((item) => item.action === "workflow.stage_completed" && episodes.some((episode) => episode.id === item.entityId)).map((item) => {
      const episode = episodes.find((candidate) => candidate.id === item.entityId)!;
      return { ...item, episodeId: episode.id, episodeNumber: episode.number, episodeTitle: episode.title, seasonNumber: episode.seasonNumber };
    });
    return { show: { ...show, productionCompany: show.title === "Signal North" ? "Vantage Television" : "Independent production" }, seasons: show.seasons.map((season) => ({ id: season.id, number: season.number, episodeCount: season.episodeCount, activeCount: season.activeEpisodeCount })), episodes, team, people, contacts: [], contactOptions: [], activity };
  }
  const context = await getActiveOrganizationContext();
  return context?.organization ? getShowWorkspace(context.organization.organizationId, showId) : null;
}
