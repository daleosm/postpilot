import Link from "next/link";
import { ArrowRight, Clapperboard, DollarSign } from "lucide-react";

import { ShowFormDialog } from "@/components/show-form-dialog";
import { PageHeader } from "@/components/operations-ui";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function ShowsPage() {
  const mayManageShows = await can("manage_shows");
  const data = await getShowsData(mayManageShows);
  if (!data) return <EmptyWorkspace />;

  return <div className="pp-page">
    <PageHeader eyebrow={`Shows · ${data.organizationName}`} title="Shows in post" description="Portfolio health across production and spend." metrics={[{ label: "Shows", value: data.shows.length }, { label: "Active episodes", value: data.shows.reduce((total, show) => total + show.activeEpisodeCount, 0) }, { label: "Budget attention", value: data.shows.filter((show) => (show.budgetHealth ?? 0) > 90).length, tone: "warning" }]} action={mayManageShows ? <ShowFormDialog companies={data.companies ?? []} /> : undefined} />
    <section className="panel overflow-hidden"><div className="grid grid-cols-[minmax(190px,1.5fr)_minmax(120px,0.9fr)_88px_88px_112px_32px] gap-3 border-b border-[#ebeae6] bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7e837f]"><span>Show</span><span>Network / client</span><span>Seasons</span><span>Active eps</span><span>Budget health</span><span /></div>
      <div className="divide-y divide-[#efeeea]">{data.shows.map((show) => <div key={show.id} className="grid grid-cols-[minmax(190px,1.5fr)_minmax(120px,0.9fr)_88px_88px_112px_32px] items-center gap-3 px-5 py-4 transition duration-150 hover:bg-[#eef4f0] hover:shadow-[inset_3px_0_0_#66877f]"><div className="min-w-0"><Link href={`/shows/${show.id}`} className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e7ebe8] text-[#586d67]"><Clapperboard size={17} /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#353b39]">{show.title}</span><span className="mt-0.5 block text-xs text-[#858a87]">{show.code} · {show.episodeCount} episodes</span></span></Link></div><p className="truncate text-xs text-[#737a76]">{show.network ?? "—"}</p><p className="text-sm font-medium text-[#454c49]">{show.seasonCount}</p><p className="text-sm font-medium text-[#454c49]">{show.activeEpisodeCount}</p><Health value={show.budgetHealth} label="burn" icon={<DollarSign size={13} />} inverse /><Link href={`/shows/${show.id}`} className="text-[#71807c]"><ArrowRight size={16} /></Link></div>)}</div>
    </section>
  </div>;
}

function Health({ value, label, icon, inverse = false }: { value: number | null; label: string; icon: React.ReactNode; inverse?: boolean }) {
  if (value === null) return <div><div className="text-xs font-medium text-[#858a87]">—</div><span className="mt-1 block text-[10px] text-[#8a8e8b]">Restricted</span></div>;
  const good = inverse ? value <= 90 : value >= 80;
  return <div><div className={`flex items-center gap-1 text-xs font-semibold ${good ? "text-[#4c806b]" : "text-[#ae6844]"}`}>{icon}{value}%</div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#ecebe7]"><div className={`h-full rounded-full ${good ? "bg-[#66877f]" : "bg-[#c17a4f]"}`} style={{ width: `${Math.min(value, 100)}%` }} /></div><span className="mt-1 block text-[10px] text-[#8a8e8b]">{label}</span></div>;
}

async function getShowsData(mayManageShows: boolean) {
  const [response, options] = await Promise.all([
      postpilotApiServerFetch<{ shows: Array<{ id: string; title: string; code: string; network: string | null; season_count: number; episode_count: number; active_episode_count: number; budget_health: number | null }> }>("/shows"),
      mayManageShows
        ? postpilotApiServerFetch<{ companies: Array<{ id: string; name: string; type: string }> }>("/shows/options/form")
        : Promise.resolve(null),
    ]);
  const context = await getActiveOrganizationContext();
  return {
      organizationName: context?.organization?.organizationName ?? "Post house",
      companies: options?.companies ?? [],
      shows: response.shows.map((show) => ({
        id: show.id,
        title: show.title,
        code: show.code,
        network: show.network,
        seasonCount: show.season_count,
        episodeCount: show.episode_count,
        activeEpisodeCount: show.active_episode_count,
        budgetHealth: show.budget_health,
      })),
  };
}

function EmptyWorkspace() { return <div className="panel mx-auto mt-20 max-w-lg p-8 text-center text-sm text-[#757b77]">Join an organization to view its shows.</div>; }
