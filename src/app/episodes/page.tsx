import { EpisodesTable, type EpisodeTableRow } from "@/components/episodes-table";
import { EpisodeFormDialog, type EpisodeSeason } from "@/components/episode-form-dialog";
import { getActiveOrganizationContext, getActiveShowName } from "@/lib/organizations";
import { can, isAssignedToEpisode, roleHome } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getDemoCommandCenterData, listEpisodes, listShows, listTeam } from "@/server/data";
import { redirect } from "next/navigation";

export default async function EpisodesPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const [mayManageShows, mayViewAssigned, organizationContext] = await Promise.all([can("manage_shows"), can("view_assigned"), getActiveOrganizationContext()]);
  if (!(mayManageShows || mayViewAssigned)) redirect(await roleHome());
  const [activeShow, query] = await Promise.all([getActiveShowName(), searchParams]);
  const seasonId = query.season;
  const canSeeAllEpisodes = mayManageShows && organizationContext?.organization?.role !== "guest";
  const data = await getEpisodesData(); const visibleEpisodes = canSeeAllEpisodes ? data.episodes : (await Promise.all(data.episodes.map(async (episode) => (await isAssignedToEpisode(episode.id)) ? episode : null))).filter((episode): episode is EpisodeTableRow => Boolean(episode)); const episodes = visibleEpisodes.filter((episode) => seasonId ? episode.seasonId === seasonId : !activeShow || episode.showTitle === activeShow); const seasons = seasonId ? data.seasons.filter((season) => season.id === seasonId) : activeShow ? data.seasons.filter((season) => season.label.startsWith(`${activeShow} ·`)) : data.seasons;
  return <div className="space-y-5"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Editorial pipeline</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Episodes</h1><p className="mt-1 text-sm text-[#747977]">Manage the current workflow stage, lock, delivery, and QC for each episode.</p></div>{canSeeAllEpisodes && <EpisodeFormDialog seasons={seasons} people={data.people} />}</header><EpisodesTable episodes={episodes} /></div>;
}

async function getEpisodesData(): Promise<{ episodes: EpisodeTableRow[]; seasons: EpisodeSeason[]; people: Array<{ id: string; name: string; role: string }> }> {
  if (isDebugDemoMode) { const demo = getDemoCommandCenterData(); return { episodes: demo.dashboard.episodes.map((episode) => ({ id: episode.id, code: `${episode.showTitle.slice(0, 2).toUpperCase()}${String(episode.number).padStart(3, "0")}`, title: episode.title, number: episode.number, showId: episode.showTitle, showTitle: episode.showTitle, seasonId: demo.showRows.find((show) => show.title === episode.showTitle)?.seasons.find((season) => season.number === episode.seasonNumber)?.id ?? episode.id, seasonNumber: episode.seasonNumber, workflowStage: episode.status.replaceAll("_", " "), editorName: episode.showTitle === "Under Current" ? "Leah Morgan" : "James Liu", producerName: episode.showTitle === "Under Current" ? "Noah Chen" : "Maya Ortiz", lockedCutDate: null, deliveryDeadline: episode.deliveryDeadline, qcStatus: episode.qcStatus, status: episode.status })), seasons: demo.showRows.flatMap((show) => show.seasons.map((season) => ({ id: season.id, label: `${show.title} · Season ${season.number}` }))), people: demo.team.map((person) => ({ id: person.id, name: person.name, role: person.role })) }; }
  const context = await getActiveOrganizationContext(); if (!context?.organization) return { episodes: [], seasons: [], people: [] };
  const rows = await listEpisodes(context.organization.organizationId);
  const shows = await listShows(context.organization.organizationId);
  const people = await listTeam(context.organization.organizationId); return { episodes: rows.map((episode) => ({ id: episode.id, code: episode.productionCode, title: episode.title, number: episode.number, showId: episode.showId, showTitle: episode.showTitle, seasonId: episode.seasonId, seasonNumber: episode.seasonNumber, workflowStage: episode.workflowStage, editorName: episode.editorName, producerName: episode.producerName, lockedCutDate: episode.lockedCutDate, deliveryDeadline: episode.deliveryDeadline, qcStatus: episode.qcStatus, status: episode.status })), seasons: shows.flatMap((show) => show.seasons.map((season) => ({ id: season.id, label: `${show.title} · Season ${season.number}` }))), people };
}
