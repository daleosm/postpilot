import Link from "next/link";
import { ArrowLeft, CalendarRange, Clapperboard, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";

import { ShowFormDialog } from "@/components/show-form-dialog";
import { EpisodeFormDialog } from "@/components/episode-form-dialog";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getDemoCommandCenterData, getShowWorkspace } from "@/server/data";

export default async function ShowDetailPage({ params }: { params: Promise<{ showId: string }> }) {
  if (!(await can("manage_shows"))) notFound();
  const { showId } = await params;
  const data = await getShowDetail(showId);
  if (!data) notFound();
  const { show, seasons, episodes, team, people, activity } = data;
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3"><Link href="/shows" className="flex items-center gap-1 text-xs font-medium text-[#617b75]"><ArrowLeft size={14} /> All shows</Link><div className="flex items-center gap-2"><EpisodeFormDialog seasons={seasons.map((season) => ({ id: season.id, label: `${show.title} · Season ${season.number}` }))} people={people} defaultSeasonId={seasons[0]?.id} /><ShowFormDialog show={show} /></div></div>
    <header className="panel p-6"><div className="flex gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e5ebe7] text-[#547168]"><Clapperboard size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[0.1em] text-[#7a827e]">{show.code} · {show.network ?? "Independent"}</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#262c29]">{show.title}</h1><p className="mt-1 text-sm text-[#777d79]">{show.productionCompany ?? "Post-production workspace"}</p></div></div></header>
    <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]"><Panel title="Seasons & episodes" icon={<CalendarRange size={16} />}><div className="divide-y divide-[#efeeea]">{seasons.map((season) => <div key={season.number} className="flex items-center justify-between px-5 py-3"><div><p className="text-sm font-medium text-[#3b423f]">Season {season.number}</p><p className="mt-0.5 text-xs text-[#858a87]">{season.activeCount} active of {season.episodeCount} episodes</p></div><span className="text-xs font-semibold text-[#58766e]">Open season <span aria-hidden>→</span></span></div>)}</div></Panel><Panel title="Episode team" icon={<UsersRound size={16} />}><div className="divide-y divide-[#efeeea]">{team.length ? team.map((person) => <div key={person.id} className="px-4 py-3"><p className="truncate text-xs font-semibold text-[#464d49]">{person.name} <span className="font-normal capitalize text-[#858a87]">· {person.role.replaceAll("_", " ")}</span></p><div className="mt-2 flex flex-wrap gap-1">{person.episodes.map((episode) => <Link key={episode.id} href={`/episodes/${episode.id}`} className="rounded bg-[#edf2ee] px-1.5 py-1 text-[10px] font-medium text-[#4f6e64] hover:bg-[#e2ebe5]">S{episode.seasonNumber} · E{String(episode.number).padStart(2, "0")} {episode.title}</Link>)}</div></div>) : <p className="px-4 py-8 text-center text-sm text-[#858a87]">Assign people from each episode.</p>}</div></Panel></section>
    <Panel title="Episode board" icon={<Clapperboard size={16} />}><div className="divide-y divide-[#efeeea]">{episodes.map((episode) => <Link key={episode.id} href={`/episodes/${episode.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[#fbfbf9]"><div><p className="text-sm font-medium text-[#3b423f]">E{String(episode.number).padStart(2, "0")} · {episode.title}</p><p className="mt-0.5 text-xs text-[#858a87]">{episode.workflowStage ?? episode.status} · {episode.editorName ?? "Unassigned"}</p></div><span className="rounded-full bg-[#edf0ed] px-2 py-1 text-[10px] font-semibold capitalize text-[#64726d]">{episode.status.replaceAll("_", " ")}</span></Link>)}</div></Panel>
    <Panel title="Recent activity" icon={<CalendarRange size={16} />}><div className="grid divide-y divide-[#efeeea] md:grid-cols-2 md:divide-x md:divide-y-0">{activity.slice(0, 4).map((item) => <div key={item.id} className="px-5 py-3"><p className="text-sm font-medium capitalize text-[#3d4542]">{item.action.replaceAll(".", " ").replaceAll("_", " ")}</p><p className="mt-1 text-xs text-[#878c89]">Operational activity</p></div>)}</div></Panel>
  </div>;
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="panel overflow-hidden"><div className="flex items-center gap-2 border-b border-[#ebeae6] px-5 py-3.5 text-sm font-semibold text-[#333a37]">{icon}{title}</div>{children}</section>; }

async function getShowDetail(showId: string) {
  if (isDebugDemoMode) {
    const demo = getDemoCommandCenterData(); const show = demo.showRows.find((item) => item.id === showId); if (!show) return null;
    const episodes = demo.dashboard.episodes.filter((episode) => episode.showTitle === show.title).map((episode) => ({ ...episode, workflowStage: episode.status.replaceAll("_", " "), editorName: episode.showTitle === "Under Current" ? "Leah Morgan" : "James Liu" }));
    const people = demo.team.map((person) => ({ ...person, availability: "available", isActive: true }));
    const team = people.map((person) => ({ ...person, episodes: episodes.filter((episode) => episode.editorName === person.name).map((episode) => ({ id: episode.id, number: episode.number, title: episode.title, seasonNumber: episode.seasonNumber })) })).filter((person) => person.episodes.length);
    return { show: { ...show, productionCompany: show.title === "Signal North" ? "Vantage Television" : "Independent production" }, seasons: show.seasons.map((season) => ({ id: season.id, number: season.number, episodeCount: season.episodeCount, activeCount: season.activeEpisodeCount })), episodes, team, people, activity: demo.dashboard.activity };
  }
  const context = await getActiveOrganizationContext();
  return context?.organization ? getShowWorkspace(context.organization.organizationId, showId) : null;
}
