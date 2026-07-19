import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodes, postWorkflows, workflowStages } from "@/lib/db/schema";
import { resolveCurrentEpisodeWorkflowState, type CurrentEpisodeWorkflowState, type CurrentEpisodeWorkflowStatus } from "@/lib/current-episode-workflow-state";

export type { CurrentEpisodeWorkflowStatus } from "@/lib/current-episode-workflow-state";
export type EpisodeWorkflowState = CurrentEpisodeWorkflowState;

function stateForEpisode(
  episode: { id: string; workflowStageId: string | null; workflowStatus: CurrentEpisodeWorkflowStatus },
  stages: Array<{ id: string; name: string; position: number }>,
): EpisodeWorkflowState {
  return resolveCurrentEpisodeWorkflowState({
    workflowStageId: episode.workflowStageId,
    workflowStatus: episode.workflowStatus,
    stages,
  });
}

async function workflowSnapshot(organizationId: string, episodeIds: string[]) {
  if (!episodeIds.length) return { episodes: [], stages: [] };
  const db = getDb();
  const [episodeRows, stages] = await Promise.all([
    db.select({ id: episodes.id, workflowStageId: episodes.workflowStageId, workflowStatus: episodes.workflowStatus })
      .from(episodes)
      .where(and(eq(episodes.organizationId, organizationId), inArray(episodes.id, episodeIds))),
    db.select({ id: workflowStages.id, name: workflowStages.name, position: workflowStages.position })
      .from(workflowStages)
      .innerJoin(postWorkflows, eq(workflowStages.workflowId, postWorkflows.id))
      .where(and(
        eq(workflowStages.organizationId, organizationId),
        eq(postWorkflows.organizationId, organizationId),
        eq(postWorkflows.isDefault, true),
      ))
      .orderBy(asc(workflowStages.position)),
  ]);
  return { episodes: episodeRows, stages };
}

/** The only operational workflow resolver: current episode stage + lifecycle. */
export async function getEpisodeWorkflowState(organizationId: string, episodeId: string) {
  const snapshot = await workflowSnapshot(organizationId, [episodeId]);
  const episode = snapshot.episodes[0];
  return episode
    ? stateForEpisode(episode, snapshot.stages)
    : stateForEpisode({ id: episodeId, workflowStageId: null, workflowStatus: "not_started" }, snapshot.stages);
}

export async function getEpisodeWorkflowStates(organizationId: string, episodeIds: string[]) {
  const snapshot = await workflowSnapshot(organizationId, episodeIds);
  return new Map(snapshot.episodes.map((episode) => [episode.id, stateForEpisode(episode, snapshot.stages)]));
}
