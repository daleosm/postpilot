import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { activityLog, episodes, seasons, shows } from "@/lib/db/schema";

export async function getDashboardData(organizationId: string) {
  const db = getDb();
  const [episodeRows, activity] = await Promise.all([
    db.select({ id: episodes.id, title: episodes.title, number: episodes.number, status: episodes.status, qcStatus: episodes.qcStatus, deliveryDeadline: episodes.deliveryDeadline, showTitle: shows.title, seasonNumber: seasons.number })
      .from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))),
    db.select({ id: activityLog.id, action: activityLog.action, entityType: activityLog.entityType, entityId: activityLog.entityId, metadata: activityLog.metadata, createdAt: activityLog.createdAt })
      .from(activityLog).where(eq(activityLog.organizationId, organizationId)).orderBy(desc(activityLog.createdAt)).limit(10),
  ]);

  return {
    metrics: {
      activeEpisodes: episodeRows.filter((episode) => !["delivered", "development"].includes(episode.status)).length,
      episodesInReview: episodeRows.filter((episode) => episode.status === "review").length,
      qcAttention: episodeRows.filter((episode) => episode.qcStatus === "needs_attention").length,
      upcomingDeliveries: episodeRows.filter((episode) => episode.deliveryDeadline && episode.deliveryDeadline > new Date()).length,
    },
    episodes: episodeRows,
    activity,
  };
}
