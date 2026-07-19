import "server-only";

import { and, eq, notInArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { postWorkOrders } from "@/lib/db/schema";
import { getDeliveryWorkflowGateReadiness } from "@/lib/delivery-workflow-gate";
import { getQcGateReadiness, qcGateBlockedMessage } from "@/lib/qc-gate";

export type OperationalWorkflowGate = {
  kind: "qc" | "delivery" | "client_acceptance" | "work_order";
  message: string;
};

type StageGateConfiguration = {
  id: string;
  requiresQcPass: boolean;
  deliveryGate: "none" | "facility_dispatch" | "client_acceptance";
};

/**
 * The deliberately small set of operational gates that may hold a sign-off.
 * This is shared by the server action and episode workspace so users see the
 * exact same concise reason before and after trying to sign off.
 */
export async function getOperationalWorkflowBlockers(input: {
  organizationId: string;
  episodeId: string;
  stage: StageGateConfiguration;
}): Promise<OperationalWorkflowGate[]> {
  const [qcReadiness, deliveryReadiness, blockingOrders] = await Promise.all([
    input.stage.requiresQcPass ? getQcGateReadiness(input.organizationId, input.episodeId) : Promise.resolve(null),
    input.stage.deliveryGate !== "none"
      ? getDeliveryWorkflowGateReadiness({
        organizationId: input.organizationId,
        episodeId: input.episodeId,
        workflowStageId: input.stage.id,
        deliveryGate: input.stage.deliveryGate,
      })
      : Promise.resolve(null),
    getDb().select({ id: postWorkOrders.id, title: postWorkOrders.title })
      .from(postWorkOrders)
      .where(and(
        eq(postWorkOrders.organizationId, input.organizationId),
        eq(postWorkOrders.episodeId, input.episodeId),
        eq(postWorkOrders.workflowStageId, input.stage.id),
        eq(postWorkOrders.isBlocking, true),
        notInArray(postWorkOrders.status, ["complete", "cancelled"]),
      ))
      .limit(2),
  ]);

  const blockers: OperationalWorkflowGate[] = [];
  if (qcReadiness && !qcReadiness.ready) blockers.push({ kind: "qc", message: qcGateBlockedMessage });
  if (deliveryReadiness && !deliveryReadiness.ready) blockers.push({
    kind: input.stage.deliveryGate === "client_acceptance" ? "client_acceptance" : "delivery",
    message: deliveryReadiness.message ?? "Finish the required delivery steps before signing off this stage.",
  });
  if (blockingOrders.length) {
    const titles = blockingOrders.map((order) => order.title).join(" and ");
    blockers.push({ kind: "work_order", message: `Blocking work order: ${titles}. Complete or cancel it before this stage can be signed off.` });
  }
  return blockers;
}
