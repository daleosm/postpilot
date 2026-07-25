import { EpisodesTable, type EpisodeTableRow } from "@/components/episodes-table";
import { EpisodeFormDialog, type EpisodeSeason } from "@/components/episode-form-dialog";
import { PageHeader } from "@/components/operations-ui";
import { getActiveOrganizationContext, getActiveShowName } from "@/lib/organizations";
import { can, canViewAllOperations, isAssignedToEpisode, roleHome } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { redirect } from "next/navigation";

export default async function EpisodesPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const [mayManageShows, mayViewAssigned, mayViewAll, organizationContext] = await Promise.all([can("manage_shows"), can("view_assigned"), canViewAllOperations(), getActiveOrganizationContext()]);
  const clientHasEpisodeAccess = organizationContext?.organization?.role === "client" && Boolean(organizationContext.person);
  if (!(mayManageShows || mayViewAssigned || mayViewAll || clientHasEpisodeAccess)) redirect(await roleHome());
  const [activeShow, query] = await Promise.all([getActiveShowName(), searchParams]);
  const seasonId = query.season;
  const canSeeAllEpisodes = (mayManageShows || mayViewAll) && organizationContext?.organization?.role !== "client";
  const data = await getEpisodesData(mayManageShows); const visibleEpisodes = canSeeAllEpisodes ? data.episodes : (await Promise.all(data.episodes.map(async (episode) => (await isAssignedToEpisode(episode.id)) ? episode : null))).filter((episode): episode is EpisodeTableRow => Boolean(episode)); const episodes = visibleEpisodes.filter((episode) => seasonId ? episode.seasonId === seasonId : !activeShow || episode.showTitle === activeShow); const seasons = seasonId ? data.seasons.filter((season) => season.id === seasonId) : activeShow ? data.seasons.filter((season) => season.label.startsWith(`${activeShow} ·`)) : data.seasons;
  return <div className="pp-page"><PageHeader eyebrow="Editorial pipeline" title="Episodes" description="Manage the current workflow stage, lock, delivery, and QC for each episode." metrics={[{ label: "In view", value: episodes.length }, { label: "QC attention", value: episodes.filter((episode) => episode.qcStatus === "needs_attention").length, tone: "warning" }, { label: "Complete", value: episodes.filter((episode) => episode.status === "complete").length, tone: "success" }]} action={mayManageShows ? <EpisodeFormDialog seasons={seasons} people={data.people} /> : undefined} /><EpisodesTable episodes={episodes} /></div>;
}

async function getEpisodesData(mayManageShows: boolean): Promise<{ episodes: EpisodeTableRow[]; seasons: EpisodeSeason[]; people: Array<{ id: string; name: string; role: string }> }> {
  const [response, options] = await Promise.all([
      postpilotApiServerFetch<{ episodes: Array<{ id: string; production_code: string | null; title: string; number: number; show_id: string; show_title: string; season_id: string; season_number: number; workflow_stage: string | null; editor_name: string | null; producer_name: string | null; locked_cut_date: string | null; delivery_deadline: string | null; qc_status: string; workflow_status: string }> }>("/episodes"),
      mayManageShows
        ? postpilotApiServerFetch<{ seasons: EpisodeSeason[]; people: Array<{ id: string; name: string; role: string }> }>("/shows/options/form")
        : Promise.resolve(null),
    ]);
  return {
      episodes: response.episodes.map((episode) => ({
        id: episode.id,
        code: episode.production_code,
        title: episode.title,
        number: episode.number,
        showId: episode.show_id,
        showTitle: episode.show_title,
        seasonId: episode.season_id,
        seasonNumber: episode.season_number,
        workflowStage: episode.workflow_stage,
        editorName: episode.editor_name,
        producerName: episode.producer_name,
        lockedCutDate: episode.locked_cut_date,
        deliveryDeadline: episode.delivery_deadline ? new Date(episode.delivery_deadline) : null,
        qcStatus: episode.qc_status,
        status: episode.workflow_status,
      })),
      seasons: options?.seasons ?? [],
      people: options?.people ?? [],
  };
}
