import "server-only";

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { activityLog } from "@/lib/db/schema";
import { listEpisodes } from "./episodes";

export async function getDashboardData(organizationId: string) {
  const db = getDb();
  const [episodeRows, activity] = await Promise.all([
    listEpisodes(organizationId),
    db.select({ id: activityLog.id, action: activityLog.action, entityType: activityLog.entityType, entityId: activityLog.entityId, metadata: activityLog.metadata, createdAt: activityLog.createdAt })
      .from(activityLog).where(eq(activityLog.organizationId, organizationId)).orderBy(desc(activityLog.createdAt)).limit(10),
  ]);

  return {
    metrics: {
      activeEpisodes: episodeRows.filter((episode) => !["complete", "not_started"].includes(episode.status)).length,
      episodesInReview: episodeRows.filter((episode) => episode.status === "awaiting_sign_off").length,
      qcAttention: episodeRows.filter((episode) => episode.qcStatus === "needs_attention").length,
      upcomingDeliveries: episodeRows.filter((episode) => episode.deliveryDeadline && episode.deliveryDeadline > new Date()).length,
    },
    episodes: episodeRows,
    activity,
  };
}
