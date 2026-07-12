import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { activityLog, episodes, reviewCuts, seasons, shows, tasks } from "@/lib/db/schema";

export async function getDashboardData(organizationId: string) {
  const db = getDb();
  const [episodeRows, taskRows, reviewRows, activity] = await Promise.all([
    db.select({ id: episodes.id, title: episodes.title, number: episodes.number, status: episodes.status, qcStatus: episodes.qcStatus, deliveryDeadline: episodes.deliveryDeadline, showTitle: shows.title, seasonNumber: seasons.number })
      .from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))),
    db.select({ id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, dueAt: tasks.dueAt })
      .from(tasks).where(eq(tasks.organizationId, organizationId)).orderBy(desc(tasks.dueAt)).limit(8),
    db.select({ id: reviewCuts.id, title: reviewCuts.title, status: reviewCuts.status, dueAt: reviewCuts.dueAt, episodeTitle: episodes.title, showTitle: shows.title })
      .from(reviewCuts).innerJoin(episodes, eq(reviewCuts.episodeId, episodes.id)).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(reviewCuts.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).orderBy(desc(reviewCuts.submittedAt)).limit(8),
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
    tasks: taskRows,
    reviewQueue: reviewRows,
    activity,
  };
}
