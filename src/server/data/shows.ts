import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { activityLog, crmCompanies, crmContacts, episodeTeamAssignments, episodes, people, seasons, showContacts, shows } from "@/lib/db/schema";
import { listEpisodes } from "./episodes";

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

export async function listShowEpisodeTeam(organizationId: string, showId: string) {
  const rows = await getDb().select({
    personId: people.id,
    name: people.name,
    role: people.role,
    episodeId: episodes.id,
    episodeNumber: episodes.number,
    episodeTitle: episodes.title,
    seasonNumber: seasons.number,
  }).from(episodeTeamAssignments)
    .innerJoin(episodes, eq(episodeTeamAssignments.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .innerJoin(people, eq(episodeTeamAssignments.personId, people.id))
    .where(and(eq(episodeTeamAssignments.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.id, showId), eq(shows.organizationId, organizationId), eq(people.organizationId, organizationId)))
    .orderBy(asc(people.name), asc(seasons.number), asc(episodes.number));

  return [...rows.reduce<Map<string, { id: string; name: string; role: string; episodes: Array<{ id: string; number: number; title: string; seasonNumber: number }> }>>((team, row) => {
    const person = team.get(row.personId) ?? { id: row.personId, name: row.name, role: row.role, episodes: [] };
    person.episodes.push({ id: row.episodeId, number: row.episodeNumber, title: row.episodeTitle, seasonNumber: row.seasonNumber });
    team.set(row.personId, person);
    return team;
  }, new Map()).values()];
}

export async function getShowWorkspace(organizationId: string, showId: string) {
  const [show, episodeRows, team, showRows, peopleRows, contactAssignments, contactOptions, workflowActivity] = await Promise.all([
    getShow(organizationId, showId),
    listEpisodes(organizationId, showId),
    listShowEpisodeTeam(organizationId, showId),
    listShows(organizationId),
    getDb().select({ id: people.id, name: people.name, role: people.role }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.isActive, true))).orderBy(asc(people.name)),
    getDb().select({ responsibility: showContacts.responsibility, name: crmContacts.name, title: crmContacts.title, email: crmContacts.email, phone: crmContacts.phone, companyName: crmCompanies.name }).from(showContacts).innerJoin(crmContacts, eq(showContacts.contactId, crmContacts.id)).innerJoin(crmCompanies, eq(crmContacts.companyId, crmCompanies.id)).where(and(eq(showContacts.organizationId, organizationId), eq(showContacts.showId, showId), eq(crmContacts.organizationId, organizationId), eq(crmCompanies.organizationId, organizationId))),
    getDb().select({ id: crmContacts.id, name: crmContacts.name, contactType: crmContacts.contactType, companyName: crmCompanies.name }).from(crmContacts).innerJoin(crmCompanies, eq(crmContacts.companyId, crmCompanies.id)).where(and(eq(crmContacts.organizationId, organizationId), eq(crmCompanies.organizationId, organizationId))).orderBy(asc(crmContacts.name)),
    getDb().select({ id: activityLog.id, action: activityLog.action, metadata: activityLog.metadata, createdAt: activityLog.createdAt, episodeId: episodes.id, episodeNumber: episodes.number, episodeTitle: episodes.title, seasonNumber: seasons.number }).from(activityLog)
      .innerJoin(episodes, sql`${activityLog.entityId} = CAST(${episodes.id} AS text)`)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(activityLog.organizationId, organizationId), eq(activityLog.entityType, "episode"), eq(activityLog.action, "workflow.stage_completed"), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.id, showId), eq(shows.organizationId, organizationId)))
      .orderBy(desc(activityLog.createdAt)).limit(8),
  ]);
  if (!show) return null;

  return {
    show,
    seasons: (showRows.find((row) => row.id === showId)?.seasons ?? []).map((season) => ({ ...season, activeCount: season.activeEpisodeCount })),
    episodes: episodeRows,
    team,
    people: peopleRows,
    contacts: contactAssignments,
    contactOptions,
    activity: workflowActivity,
  };
}
