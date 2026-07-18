import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { getDeliveryWorkflowGateState, type DeliveryWorkflowGate } from "@/lib/delivery-lifecycle";
import { episodeDeliveryAcceptanceExceptions, episodeDeliveryItems, episodeDeliveryManifests, episodes } from "@/lib/db/schema";

/** Tenant-scoped readiness used by both sign-off and sequential stage movement. */
export async function getDeliveryWorkflowGateReadiness(input: {
  organizationId: string;
  episodeId: string;
  workflowStageId: string;
  deliveryGate: DeliveryWorkflowGate;
}) {
  if (input.deliveryGate === "none") return getDeliveryWorkflowGateState([], "none");
  const db = getDb();
  const [manifest] = await db.select({ id: episodeDeliveryManifests.id })
    .from(episodeDeliveryManifests)
    .innerJoin(episodes, and(
      eq(episodeDeliveryManifests.episodeId, episodes.id),
      eq(episodes.organizationId, input.organizationId),
    ))
    .where(and(
      eq(episodeDeliveryManifests.organizationId, input.organizationId),
      eq(episodeDeliveryManifests.episodeId, input.episodeId),
    ))
    .limit(1);
  if (!manifest) return {
    ready: false,
    facilityReady: false,
    clientReceiptComplete: false,
    message: "This episode has no delivery manifest. Apply the show’s delivery profile before signing off this stage.",
  };
  const [items, exception] = await Promise.all([
    db.select({
      required: episodeDeliveryItems.required,
      status: episodeDeliveryItems.status,
      qcRequired: episodeDeliveryItems.qcRequired,
      qcResult: episodeDeliveryItems.qcResult,
    }).from(episodeDeliveryItems).where(and(
      eq(episodeDeliveryItems.organizationId, input.organizationId),
      eq(episodeDeliveryItems.episodeDeliveryManifestId, manifest.id),
      eq(episodeDeliveryItems.episodeId, input.episodeId),
    )),
    input.deliveryGate === "client_acceptance"
      ? db.select({ id: episodeDeliveryAcceptanceExceptions.id }).from(episodeDeliveryAcceptanceExceptions).where(and(
        eq(episodeDeliveryAcceptanceExceptions.organizationId, input.organizationId),
        eq(episodeDeliveryAcceptanceExceptions.episodeId, input.episodeId),
        eq(episodeDeliveryAcceptanceExceptions.workflowStageId, input.workflowStageId),
      )).limit(1)
      : Promise.resolve([]),
  ]);
  return getDeliveryWorkflowGateState(items, input.deliveryGate, Boolean(exception[0]));
}
