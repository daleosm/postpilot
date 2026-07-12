import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { deliverables, deliveryRequirements, episodes, seasons, shows } from "@/lib/db/schema";

export async function listDeliverables(organizationId: string) {
  const db = getDb();
  const rows = await db.select({ id: deliverables.id, name: deliverables.name, destination: deliverables.destination, status: deliverables.status, dueAt: deliverables.dueAt, deliveredAt: deliverables.deliveredAt, episodeTitle: episodes.title, episodeNumber: episodes.number, showTitle: shows.title })
    .from(deliverables).innerJoin(episodes, eq(deliverables.episodeId, episodes.id)).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(deliverables.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).orderBy(asc(deliverables.dueAt));
  // Scope requirements through organization-owned deliverables; never hydrate a
  // global checklist and filter it in memory.
  const requirements = await db.select({ id: deliveryRequirements.id, deliverableId: deliveryRequirements.deliverableId, label: deliveryRequirements.label, specification: deliveryRequirements.specification, isRequired: deliveryRequirements.isRequired, isComplete: deliveryRequirements.isComplete, evidenceUrl: deliveryRequirements.evidenceUrl, checksum: deliveryRequirements.checksum, completedAt: deliveryRequirements.completedAt })
    .from(deliveryRequirements).innerJoin(deliverables, eq(deliveryRequirements.deliverableId, deliverables.id))
    .where(and(eq(deliveryRequirements.organizationId, organizationId), eq(deliverables.organizationId, organizationId)));
  return rows.map((row) => ({ ...row, requirements: requirements.filter((requirement) => requirement.deliverableId === row.id) }));
}
