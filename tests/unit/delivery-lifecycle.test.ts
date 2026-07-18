import assert from "node:assert/strict";
import test from "node:test";

import { getDeliveryManifestReadiness, getDeliveryWorkflowGateState, validateDeliveryItemTransition } from "../../src/lib/delivery-lifecycle";

function transition(currentStatus: Parameters<typeof validateDeliveryItemTransition>[0]["currentStatus"], nextStatus: Parameters<typeof validateDeliveryItemTransition>[0]["nextStatus"], overrides = {}) {
  return validateDeliveryItemTransition({ currentStatus, nextStatus, qcRequired: true, hasExternalEvidence: true, hasReason: true, canWaive: true, canRecordRejection: true, ...overrides });
}

test("QC-required delivery items follow the controlled facility-to-client lifecycle", () => {
  assert.equal(transition("not_started", "preparing"), null);
  assert.equal(transition("preparing", "ready_for_qc"), null);
  assert.equal(transition("ready_for_qc", "qc_passed"), null);
  assert.equal(transition("qc_passed", "dispatched"), null);
  assert.equal(transition("dispatched", "receipt_confirmed"), null);
});

test("a QC-required item cannot skip preparation, QC, or delivery evidence", () => {
  assert.match(transition("not_started", "dispatched") ?? "", /cannot move/);
  assert.match(transition("ready_for_qc", "dispatched", { hasExternalEvidence: true }) ?? "", /passing QC/);
  assert.match(transition("qc_passed", "dispatched", { hasExternalEvidence: false }) ?? "", /reference or link/);
  assert.match(transition("dispatched", "dispatched") ?? "", /already/);
});

test("a non-QC component can leave ready-for-QC only with delivery evidence", () => {
  assert.equal(transition("ready_for_qc", "dispatched", { qcRequired: false, hasExternalEvidence: true }), null);
  assert.match(transition("ready_for_qc", "dispatched", { qcRequired: false, hasExternalEvidence: false }) ?? "", /reference or link/);
});

test("rejection and waiver are both reasoned and authorised exceptions", () => {
  assert.match(transition("dispatched", "rejected", { canRecordRejection: false }) ?? "", /not authorised/);
  assert.match(transition("dispatched", "rejected", { hasReason: false }) ?? "", /rejection reason/);
  assert.equal(transition("dispatched", "rejected"), null);
  assert.match(transition("preparing", "waived", { canWaive: false }) ?? "", /not authorised/);
  assert.match(transition("preparing", "waived", { hasReason: false }) ?? "", /waiver reason/);
  assert.equal(transition("preparing", "waived"), null);
  assert.match(transition("receipt_confirmed", "waived") ?? "", /cannot be waived/);
});

test("manifest readiness ignores optional items and distinguishes dispatch from acceptance", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const readiness = getDeliveryManifestReadiness([
    { required: true, status: "receipt_confirmed", dueDate: "2026-07-16" },
    { required: true, status: "dispatched", dueDate: "2026-07-18" },
    { required: true, status: "not_started", dueDate: "2026-07-15" },
    { required: false, status: "not_started", dueDate: "2026-07-01" },
  ], now);
  assert.equal(readiness.requiredItemCount, 3);
  assert.equal(readiness.completedRequiredItemCount, 1);
  assert.equal(readiness.progressPercent, 33);
  assert.equal(readiness.facilityDispatched, false);
  assert.equal(readiness.clientNetworkAccepted, false);
  assert.equal(readiness.deadlineRisk, "overdue");
  assert.equal(readiness.overdueRequiredItemCount, 1);
});

test("manifest readiness distinguishes an approaching required deadline from an overdue one", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const atRisk = getDeliveryManifestReadiness([{ required: true, status: "preparing", dueDate: "2026-07-19" }], now);
  assert.equal(atRisk.deadlineRisk, "at_risk");
  assert.equal(atRisk.atRiskRequiredItemCount, 1);
  const onTrack = getDeliveryManifestReadiness([{ required: true, status: "preparing", dueDate: "2026-07-22" }], now);
  assert.equal(onTrack.deadlineRisk, "on_track");
});

test("date-only due dates remain open until the end of their operational day", () => {
  const readiness = getDeliveryManifestReadiness([
    { required: true, status: "preparing", dueDate: "2026-07-17" },
  ], new Date("2026-07-17T12:00:00.000Z"));
  assert.equal(readiness.deadlineRisk, "at_risk");
  assert.equal(readiness.overdueRequiredItemCount, 0);
});

test("all dispatched required items are not client accepted until receipt is confirmed", () => {
  const dispatched = getDeliveryManifestReadiness([
    { required: true, status: "dispatched", dueDate: "2026-07-20" },
    { required: true, status: "waived", dueDate: null },
  ], new Date("2026-07-17T12:00:00.000Z"));
  assert.equal(dispatched.facilityDispatched, true);
  assert.equal(dispatched.clientNetworkAccepted, false);
  assert.equal(dispatched.progressPercent, 50);

  const accepted = getDeliveryManifestReadiness([
    { required: true, status: "receipt_confirmed", dueDate: "2026-07-20" },
    { required: true, status: "waived", dueDate: null },
  ], new Date("2026-07-17T12:00:00.000Z"));
  assert.equal(accepted.clientNetworkAccepted, true);
  assert.equal(accepted.progressPercent, 100);
});

test("manifest readiness reports required external-recipient gaps", () => {
  const readiness = getDeliveryManifestReadiness([
    { required: true, status: "preparing", dueDate: null, requiresExternalRecipient: true, recipientContactId: null },
    { required: true, status: "preparing", dueDate: null, requiresExternalRecipient: true, recipientContactId: "crm-contact" },
    { required: false, status: "preparing", dueDate: null, requiresExternalRecipient: true, recipientContactId: null },
  ]);
  assert.equal(readiness.missingRequiredRecipientCount, 1);
  assert.equal(readiness.hasDeliveryContactGaps, true);
});

test("waived delivery requirements do not continue to report a missing recipient", () => {
  const readiness = getDeliveryManifestReadiness([
    { required: true, status: "waived", dueDate: null, requiresExternalRecipient: true, recipientContactId: null },
  ]);
  assert.equal(readiness.hasDeliveryContactGaps, false);
  assert.equal(readiness.missingRequiredRecipientCount, 0);
});

test("the Delivery gate requires passing required QC and facility dispatch", () => {
  const blockedByQc = getDeliveryWorkflowGateState([
    { required: true, status: "ready_for_qc", qcRequired: true, qcResult: "not_started" },
  ], "facility_dispatch");
  assert.equal(blockedByQc.ready, false);
  assert.match(blockedByQc.message ?? "", /passing QC/);

  const blockedByDispatch = getDeliveryWorkflowGateState([
    { required: true, status: "qc_passed", qcRequired: true, qcResult: "passed" },
  ], "facility_dispatch");
  assert.equal(blockedByDispatch.ready, false);
  assert.match(blockedByDispatch.message ?? "", /not dispatched/);

  const ready = getDeliveryWorkflowGateState([
    { required: true, status: "dispatched", qcRequired: true, qcResult: "passed" },
    { required: false, status: "qc_failed", qcRequired: true, qcResult: "failed" },
  ], "facility_dispatch");
  assert.equal(ready.ready, true);
});

test("client acceptance requires receipt or a narrow authorised exception", () => {
  const dispatched = [{ required: true, status: "dispatched" as const, qcRequired: true, qcResult: "passed" as const }];
  const missingReceipt = getDeliveryWorkflowGateState(dispatched, "client_acceptance");
  assert.equal(missingReceipt.ready, false);
  assert.match(missingReceipt.message ?? "", /receipt confirmation/);
  assert.equal(getDeliveryWorkflowGateState(dispatched, "client_acceptance", true).ready, true);

  const failed = getDeliveryWorkflowGateState([
    { required: true, status: "qc_failed", qcRequired: true, qcResult: "failed" },
  ], "client_acceptance", true);
  assert.equal(failed.ready, false);
  assert.match(failed.message ?? "", /failed QC/);
});
