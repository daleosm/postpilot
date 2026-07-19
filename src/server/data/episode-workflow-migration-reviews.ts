import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { episodeWorkflowMigrationReviews, episodes, seasons, shows } from "@/lib/db/schema";

export async function listOpenEpisodeWorkflowMigrationReviews(organizationId: string) {
  return getDb().select({
    id: episodeWorkflowMigrationReviews.id,
    episodeId: episodes.id,
    title: episodes.title,
    number: episodes.number,
    productionCode: episodes.productionCode,
    showTitle: shows.title,
    seasonNumber: seasons.number,
    reason: episodeWorkflowMigrationReviews.reason,
    legacyStatus: episodeWorkflowMigrationReviews.legacyStatus,
    createdAt: episodeWorkflowMigrationReviews.createdAt,
  }).from(episodeWorkflowMigrationReviews)
    .innerJoin(episodes, eq(episodeWorkflowMigrationReviews.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(
      eq(episodeWorkflowMigrationReviews.organizationId, organizationId),
      eq(episodeWorkflowMigrationReviews.status, "open"),
      eq(episodes.organizationId, organizationId),
      eq(seasons.organizationId, organizationId),
      eq(shows.organizationId, organizationId),
    )).orderBy(asc(shows.title), asc(seasons.number), asc(episodes.number));
}
