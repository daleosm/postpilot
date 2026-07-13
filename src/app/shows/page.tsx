import Link from "next/link";
import { ArrowRight, Clapperboard, DollarSign } from "lucide-react";

import { ShowFormDialog } from "@/components/show-form-dialog";
import { getActiveOrganizationContext, getActiveShowName } from "@/lib/organizations";
import { can, roleHome } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getBudgetData, getDemoCommandCenterData, listCrmCompanyOptions, listEpisodes, listShows } from "@/server/data";
import { redirect } from "next/navigation";

export default async function ShowsPage() {
  if (!(await can("manage_shows"))) redirect(await roleHome());
  const activeShow = await getActiveShowName(); const raw = await getShowsData(); const data = raw ? { ...raw, shows: raw.shows.filter((show) => !activeShow || show.title === activeShow) } : null;
  if (!data) return <EmptyWorkspace />;

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Shows · {data.organizationName}</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Shows in post</h1><p className="mt-1 text-sm text-[#747977]">Portfolio health across production and spend.</p></div><ShowFormDialog companies={data.companies ?? []} /></header>
    <section className="panel overflow-hidden"><div className="grid grid-cols-[minmax(190px,1.5fr)_minmax(120px,0.9fr)_88px_88px_112px_32px] gap-3 border-b border-[#ebeae6] bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7e837f]"><span>Show</span><span>Network / client</span><span>Seasons</span><span>Active eps</span><span>Budget health</span><span /></div>
      <div className="divide-y divide-[#efeeea]">{data.shows.map((show) => <div key={show.id} className="grid grid-cols-[minmax(190px,1.5fr)_minmax(120px,0.9fr)_88px_88px_112px_32px] items-center gap-3 px-5 py-4 transition duration-150 hover:bg-[#eef4f0] hover:shadow-[inset_3px_0_0_#66877f]"><div className="min-w-0"><Link href={`/shows/${show.id}`} className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e7ebe8] text-[#586d67]"><Clapperboard size={17} /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#353b39]">{show.title}</span><span className="mt-0.5 block text-xs text-[#858a87]">{show.code} · {show.episodeCount} episodes</span></span></Link></div><p className="truncate text-xs text-[#737a76]">{show.network ?? "—"}</p><p className="text-sm font-medium text-[#454c49]">{show.seasonCount}</p><p className="text-sm font-medium text-[#454c49]">{show.activeEpisodeCount}</p><Health value={show.budgetHealth} label="burn" icon={<DollarSign size={13} />} inverse /><Link href={`/shows/${show.id}`} className="text-[#71807c]"><ArrowRight size={16} /></Link></div>)}</div>
    </section>
  </div>;
}

function Health({ value, label, icon, inverse = false }: { value: number; label: string; icon: React.ReactNode; inverse?: boolean }) {
  const good = inverse ? value <= 90 : value >= 80;
  return <div><div className={`flex items-center gap-1 text-xs font-semibold ${good ? "text-[#4c806b]" : "text-[#ae6844]"}`}>{icon}{value}%</div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${good ? "bg-[#66877f]" : "bg-[#c17a4f]"}`} style={{ width: `${Math.min(value, 100)}%` }} /></div><span className="mt-1 block text-[10px] text-[#8a8e8b]">{label}</span></div>;
}

async function getShowsData() {
  if (isDebugDemoMode) {
    const demo = getDemoCommandCenterData();
    return { organizationName: demo.organizationName, companies: [], shows: demo.showRows.map((show, index) => ({ ...show, seasonCount: show.seasons.length, episodeCount: show.seasons.reduce((sum, season) => sum + season.episodeCount, 0), activeEpisodeCount: show.seasons.reduce((sum, season) => sum + season.activeEpisodeCount, 0), budgetHealth: [90, 84, 96][index] })) };
  }
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return null;
  const organizationId = context.organization.organizationId;
  const [shows, episodeRows, budget, companies] = await Promise.all([listShows(organizationId), listEpisodes(organizationId), getBudgetData(organizationId), listCrmCompanyOptions(organizationId)]);
  return { organizationName: context.organization.organizationName, shows: shows.map((show) => {
    const showEpisodes = episodeRows.filter((episode) => episode.showId === show.id);
    const lines = budget.lines.filter((line) => line.showTitle === show.title);
    const budgeted = lines.reduce((sum, line) => sum + Number(line.budgetedAmount), 0);
    const actual = lines.reduce((sum, line) => sum + Number(line.actualAmount), 0);
    return { ...show, seasonCount: show.seasons.length, episodeCount: showEpisodes.length, activeEpisodeCount: showEpisodes.filter((episode) => episode.status !== "delivered").length, budgetHealth: budgeted ? Math.round((actual / budgeted) * 100) : 0 };
  }), companies };
}

function EmptyWorkspace() { return <div className="panel mx-auto mt-20 max-w-lg p-8 text-center text-sm text-[#757b77]">Join an organization to view its shows.</div>; }
