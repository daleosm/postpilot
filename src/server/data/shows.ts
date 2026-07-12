import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodes, seasons, showTeamAssignments, shows } from "@/lib/db/schema";
import { getDashboardData } from "./dashboard";
import { listEpisodes } from "./episodes";
import { listTeam } from "./team";

export async function listShows(organizationId: string) {
  const db = getDb();
  const rows = await db.select({ showId: shows.id, title: shows.title, code: shows.code, network: shows.network, seasonId: seasons.id, seasonNumber: seasons.number, episodeId: episodes.id, episodeStatus: episodes.status })
    .from(shows).leftJoin(seasons, and(eq(seasons.showId, shows.id), eq(seasons.organizationId, organizationId))).leftJoin(episodes, and(eq(episodes.seasonId, seasons.id), eq(episodes.organizationId, organizationId))).where(eq(shows.organizationId, organizationId)).orderBy(asc(shows.title), asc(seasons.number));

  return Object.values(rows.reduce<Record<string, { id: string; title: string; code: string; network: string | null; seasons: Map<string, { id: string; number: number; episodeCount: number; activeEpisodeCount: number }> }>>((result, row) => {
    const show = result[row.showId] ?? { id: row.showId, title: row.title, code: row.code, network: row.network, seasons: new Map() };
    if (row.seasonId) {
      const season = show.seasons.get(row.seasonId) ?? { id: row.seasonId, number: row.seasonNumber ?? 0, episodeCount: 0, activeEpisodeCount: 0 };
      if (row.episodeId) {
        season.episodeCount += 1;
        if (row.episodeStatus !== "delivered") season.activeEpisodeCount += 1;
      }
      show.seasons.set(row.seasonId, season);
    }
    result[row.showId] = show;
    return result;
  }, {})).map((show) => ({ ...show, seasons: [...show.seasons.values()] }));
}

/** Lightweight tenant-scoped options for the persistent show switcher. */
export async function listShowOptions(organizationId: string) {
  return getDb()
    .select({ id: shows.id, title: shows.title })
    .from(shows)
    .where(eq(shows.organizationId, organizationId))
    .orderBy(asc(shows.title), asc(shows.id));
}

export async function getShow(organizationId: string, showId: string) {
  const db = getDb();
  const rows = await db.select().from(shows).where(and(eq(shows.id, showId), eq(shows.organizationId, organizationId))).limit(1);
  return rows[0] ?? null;
}

export async function listShowTeam(organizationId: string, showId: string) {
  const [allTeam, assignments] = await Promise.all([
    listTeam(organizationId),
    getDb().select({ personId: showTeamAssignments.personId })
      .from(showTeamAssignments)
      .innerJoin(shows, and(eq(showTeamAssignments.showId, shows.id), eq(showTeamAssignments.organizationId, organizationId)))
      .where(and(eq(showTeamAssignments.showId, showId), eq(showTeamAssignments.organizationId, organizationId), eq(shows.organizationId, organizationId))),
  ]);
  const assignedIds = new Set(assignments.map((assignment) => assignment.personId));
  return allTeam.filter((person) => assignedIds.has(person.id));
}

export async function getShowWorkspace(organizationId: string, showId: string) {
  const [show, episodeRows, availableTeam, team, dashboard, showRows] = await Promise.all([
    getShow(organizationId, showId),
    listEpisodes(organizationId, showId),
    listTeam(organizationId),
    listShowTeam(organizationId, showId),
    getDashboardData(organizationId),
    listShows(organizationId),
  ]);
  if (!show) return null;

  return {
    show,
    seasons: (showRows.find((row) => row.id === showId)?.seasons ?? []).map((season) => ({ ...season, activeCount: season.activeEpisodeCount })),
    episodes: episodeRows,
    team,
    availableTeam,
    activity: dashboard.activity,
  };
}
