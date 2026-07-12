import { EpisodesTable, type EpisodeTableRow } from "@/components/episodes-table";
import { EpisodeFormDialog, type EpisodeSeason } from "@/components/episode-form-dialog";
import { getActiveOrganizationContext, getActiveShowName } from "@/lib/organizations";
import { can, getCurrentPerson, isAssignedToEpisode, isExternalReviewerRole, roleHome } from "@/lib/permissions";
import { isDebugDemoMode } from "@/lib/runtime";
import { getDemoCommandCenterData, listEpisodes, listShows } from "@/server/data";
import { redirect } from "next/navigation";

export default async function EpisodesPage() {
  const [currentPerson, mayManageShows, mayViewAssigned] = await Promise.all([getCurrentPerson(), can("manage_shows"), can("view_assigned")]);
  const isRestrictedExternalReviewer = isExternalReviewerRole(currentPerson?.role) && !(currentPerson?.role === "director" && mayManageShows);
  if (isRestrictedExternalReviewer || !(mayManageShows || mayViewAssigned)) redirect(roleHome(currentPerson?.role));
  const activeShow = await getActiveShowName();
  const data = await getEpisodesData(); const visibleEpisodes = mayManageShows ? data.episodes : (await Promise.all(data.episodes.map(async (episode) => (await isAssignedToEpisode(episode.id)) ? episode : null))).filter((episode): episode is EpisodeTableRow => Boolean(episode)); const episodes = visibleEpisodes.filter((episode) => !activeShow || episode.showTitle === activeShow); const seasons = activeShow ? data.seasons.filter((season) => season.label.startsWith(`${activeShow} ·`)) : data.seasons;
  return <div className="space-y-5"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Editorial pipeline</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Episodes</h1><p className="mt-1 text-sm text-[#747977]">Track assignment, workflow, lock, delivery, and QC at episode level.</p></div>{mayManageShows && <EpisodeFormDialog seasons={seasons} />}</header><EpisodesTable episodes={episodes} /></div>;
}

async function getEpisodesData(): Promise<{ episodes: EpisodeTableRow[]; seasons: EpisodeSeason[] }> {
  if (isDebugDemoMode) { const demo = getDemoCommandCenterData(); return { episodes: demo.dashboard.episodes.map((episode) => ({ id: episode.id, code: `${episode.showTitle.slice(0, 2).toUpperCase()}${String(episode.number).padStart(3, "0")}`, title: episode.title, number: episode.number, showId: episode.showTitle, showTitle: episode.showTitle, seasonNumber: episode.seasonNumber, workflowStage: episode.status.replaceAll("_", " "), editorName: episode.showTitle === "Under Current" ? "Leah Morgan" : "James Liu", producerName: episode.showTitle === "Under Current" ? "Noah Chen" : "Maya Ortiz", lockedCutDate: null, deliveryDeadline: episode.deliveryDeadline, qcStatus: episode.qcStatus, status: episode.status })), seasons: demo.showRows.flatMap((show) => show.seasons.map((season) => ({ id: season.id, label: `${show.title} · Season ${season.number}` }))) }; }
  const context = await getActiveOrganizationContext(); if (!context?.organization) return { episodes: [], seasons: [] };
  const rows = await listEpisodes(context.organization.organizationId);
  const shows = await listShows(context.organization.organizationId);
  return { episodes: rows.map((episode) => ({ id: episode.id, code: episode.productionCode, title: episode.title, number: episode.number, showId: episode.showId, showTitle: episode.showTitle, seasonNumber: episode.seasonNumber, workflowStage: episode.workflowStage, editorName: episode.editorName, producerName: episode.producerName, lockedCutDate: episode.lockedCutDate, deliveryDeadline: episode.deliveryDeadline, qcStatus: episode.qcStatus, status: episode.status })), seasons: shows.flatMap((show) => show.seasons.map((season) => ({ id: season.id, label: `${show.title} · Season ${season.number}` }))) };
}
