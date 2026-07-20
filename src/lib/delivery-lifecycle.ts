export const deliveryItemStatuses = ["not_started", "preparing", "ready_for_qc", "qc_failed", "qc_passed", "dispatched", "receipt_confirmed", "rejected", "waived"] as const;
export type DeliveryItemStatus = (typeof deliveryItemStatuses)[number];
export const deliveryWorkflowGates = ["none", "facility_dispatch", "client_acceptance"] as const;
export type DeliveryWorkflowGate = (typeof deliveryWorkflowGates)[number];

export type DeliveryTransitionInput = {
  currentStatus: DeliveryItemStatus;
  nextStatus: DeliveryItemStatus;
  qcRequired: boolean;
  hasExternalEvidence: boolean;
  hasReason: boolean;
  canWaive: boolean;
  canRecordRejection: boolean;
};

const normalTransitions: Record<DeliveryItemStatus, DeliveryItemStatus[]> = {
  not_started: ["preparing"],
  preparing: ["ready_for_qc"],
  ready_for_qc: ["qc_failed", "qc_passed", "dispatched"],
  qc_failed: ["preparing"],
  qc_passed: ["dispatched"],
  dispatched: ["receipt_confirmed", "rejected"],
  receipt_confirmed: [],
  rejected: ["preparing"],
  waived: [],
};

export function validateDeliveryItemTransition(input: DeliveryTransitionInput): string | null {
  const { currentStatus, nextStatus } = input;
  if (currentStatus === nextStatus) return "This delivery item is already at that lifecycle state.";
  if (nextStatus === "waived") {
    if (currentStatus === "receipt_confirmed") return "An accepted delivery item cannot be waived.";
    if (!input.canWaive) return "Your role is not authorised to waive a delivery requirement.";
    return input.hasReason ? null : "A waiver reason is required.";
  }
  if (nextStatus === "rejected") {
    if (!input.canRecordRejection) return "Your role is not authorised to record a delivery rejection.";
    if (!input.hasReason) return "A rejection reason is required.";
  }
  if (!normalTransitions[currentStatus].includes(nextStatus)) return `A delivery item cannot move from ${currentStatus.replaceAll("_", " ")} to ${nextStatus.replaceAll("_", " ")}.`;
  if (currentStatus === "ready_for_qc" && nextStatus === "dispatched" && input.qcRequired) return "This item requires a passing QC result before it can be dispatched.";
  if (nextStatus === "dispatched" && !input.hasExternalEvidence) return "Add an external delivery reference or link before marking this item dispatched.";
  return null;
}

type ReadinessItem = {
  required: boolean;
  status: DeliveryItemStatus;
  dueDate: string | Date | null;
  requiresExternalRecipient?: boolean;
  recipientContactId?: string | null;
};

function dueDateMoment(value: string | Date) {
  // A profile deadline without a time is an operational end-of-day deadline,
  // not midnight at the start of that calendar date.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999Z`);
  return new Date(value);
}

export function getDeliveryManifestReadiness(items: ReadinessItem[], now = new Date()) {
  const requiredItems = items.filter((item) => item.required);
  const completed = requiredItems.filter((item) => ["receipt_confirmed", "waived"].includes(item.status)).length;
  const outstanding = requiredItems.filter((item) => !["receipt_confirmed", "waived"].includes(item.status));
  const datedOutstanding = outstanding.flatMap((item) => {
    if (!item.dueDate) return [];
    const due = dueDateMoment(item.dueDate);
    return Number.isNaN(due.getTime()) ? [] : [due];
  });
  const overdueCount = datedOutstanding.filter((due) => due.getTime() < now.getTime()).length;
  const atRiskCount = datedOutstanding.filter((due) => due.getTime() >= now.getTime() && due.getTime() <= now.getTime() + 3 * 86_400_000).length;
  const facilityDispatched = requiredItems.every((item) => ["dispatched", "receipt_confirmed", "waived"].includes(item.status));
  const clientNetworkAccepted = requiredItems.every((item) => ["receipt_confirmed", "waived"].includes(item.status));
  // A formally waived requirement is intentionally complete for delivery
  // readiness. It must not keep an otherwise ready manifest in a contact-gap
  // state merely because no external recipient was selected.
  const missingRequiredRecipientCount = outstanding.filter((item) => item.requiresExternalRecipient && !item.recipientContactId).length;

  return {
    requiredItemCount: requiredItems.length,
    completedRequiredItemCount: completed,
    outstandingRequiredItemCount: outstanding.length,
    progressPercent: requiredItems.length ? Math.round((completed / requiredItems.length) * 100) : 100,
    facilityDispatched,
    clientNetworkAccepted,
    deadlineRisk: overdueCount ? "overdue" as const : atRiskCount ? "at_risk" as const : "on_track" as const,
    overdueRequiredItemCount: overdueCount,
    atRiskRequiredItemCount: atRiskCount,
    requiredItemsWithoutDueDate: outstanding.filter((item) => !item.dueDate).length,
    missingRequiredRecipientCount,
    hasDeliveryContactGaps: missingRequiredRecipientCount > 0,
  };
}

type WorkflowGateItem = {
  required: boolean;
  status: DeliveryItemStatus;
  qcRequired: boolean;
  qcResult: "not_required" | "not_started" | "passed" | "failed" | "waived";
};

/**
 * Workflow gates use the manifest snapshot, never a mutable delivery profile.
 * A local acceptance exception is deliberately narrow: it cannot bypass QC,
 * rejection, or facility dispatch; it only replaces recipient confirmation.
 */
export function getDeliveryWorkflowGateState(items: WorkflowGateItem[], gate: DeliveryWorkflowGate, hasLocalAcceptanceException = false) {
  if (gate === "none") return { ready: true, facilityReady: true, clientReceiptComplete: true, message: null };
  const required = items.filter((item) => item.required);
  if (!required.length) return {
    ready: false,
    facilityReady: false,
    clientReceiptComplete: false,
    message: "This delivery manifest has no required items. Add or apply the confirmed delivery requirements before signing off this stage.",
  };
  const failedOrRejected = required.filter((item) => item.status === "qc_failed" || item.status === "rejected");
  if (failedOrRejected.length) return {
    ready: false,
    facilityReady: false,
    clientReceiptComplete: false,
    message: `${failedOrRejected.length} required delivery item${failedOrRejected.length === 1 ? " has" : "s have"} failed QC or been rejected. Resolve the correction before sign-off.`,
  };
  const qcOutstanding = required.filter((item) => item.qcRequired && !["passed", "waived"].includes(item.qcResult));
  const dispatchOutstanding = required.filter((item) => !["dispatched", "receipt_confirmed", "waived"].includes(item.status));
  const facilityReady = qcOutstanding.length === 0 && dispatchOutstanding.length === 0;
  if (!facilityReady) return {
    ready: false,
    facilityReady: false,
    clientReceiptComplete: false,
    message: qcOutstanding.length
      ? `${qcOutstanding.length} required delivery item${qcOutstanding.length === 1 ? " still needs" : "s still need"} passing QC before delivery sign-off.`
      : `${dispatchOutstanding.length} required delivery item${dispatchOutstanding.length === 1 ? " is" : "s are"} not dispatched.`,
  };
  if (gate === "facility_dispatch") return { ready: true, facilityReady: true, clientReceiptComplete: false, message: null };
  const receiptOutstanding = required.filter((item) => !["receipt_confirmed", "waived"].includes(item.status));
  if (!receiptOutstanding.length) return { ready: true, facilityReady: true, clientReceiptComplete: true, message: null };
  if (hasLocalAcceptanceException) return { ready: true, facilityReady: true, clientReceiptComplete: false, message: null };
  return {
    ready: false,
    facilityReady: true,
    clientReceiptComplete: false,
    message: `${receiptOutstanding.length} required delivery item${receiptOutstanding.length === 1 ? " still needs" : "s still need"} recipient receipt confirmation, or an authorised local acceptance exception.`,
  };
}
