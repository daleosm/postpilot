export type DeliveryRegisterStateItem = { label: string; required: boolean; status: string };

export type DeliveryRegisterStateEntry = {
  manifest: {
    items: DeliveryRegisterStateItem[];
    readiness: {
      clientNetworkAccepted: boolean;
      facilityDispatched: boolean;
      deadlineRisk: "on_track" | "at_risk" | "overdue";
      hasDeliveryContactGaps: boolean;
    };
  } | null;
};

/** The concise operational status used by the Delivery register. */
export function getDeliveryRegisterState(entry: DeliveryRegisterStateEntry) {
  if (!entry.manifest) return "not_configured";
  const { readiness } = entry.manifest;
  if (readiness.clientNetworkAccepted) return "accepted";
  if (readiness.deadlineRisk !== "on_track" || readiness.hasDeliveryContactGaps || entry.manifest.items.some((item) => ["qc_failed", "rejected"].includes(item.status))) return "needs_attention";
  if (readiness.facilityDispatched) return "dispatched";
  return "in_progress";
}

/** One clear next step prevents a technical delivery register from becoming a wall of statuses. */
export function getNextDeliveryAction(entry: DeliveryRegisterStateEntry) {
  if (!entry.manifest) return "Apply a delivery profile";
  const { readiness } = entry.manifest;
  if (readiness.hasDeliveryContactGaps) return "Choose a delivery recipient";
  const blocked = entry.manifest.items.find((item) => item.required && ["qc_failed", "rejected"].includes(item.status));
  if (blocked) return `Resolve ${blocked.label}`;
  const waiting = entry.manifest.items.find((item) => item.required && item.status === "dispatched");
  if (waiting) return `Confirm receipt for ${waiting.label}`;
  const outstanding = entry.manifest.items.find((item) => item.required && !["receipt_confirmed", "waived"].includes(item.status));
  return outstanding ? `Prepare ${outstanding.label}` : "Delivery complete";
}
