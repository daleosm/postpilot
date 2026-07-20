import assert from "node:assert/strict";
import test from "node:test";

import { getDeliveryRegisterState, getNextDeliveryAction, type DeliveryRegisterStateEntry } from "../../src/lib/delivery-register-state";

function entry(overrides: Partial<NonNullable<DeliveryRegisterStateEntry["manifest"]>["readiness"]> = {}, items: Array<{ label: string; required: boolean; status: string }> = [{ label: "ProRes master", required: true, status: "preparing" }]): DeliveryRegisterStateEntry {
  return { manifest: { items, readiness: { clientNetworkAccepted: false, facilityDispatched: false, deadlineRisk: "on_track", hasDeliveryContactGaps: false, ...overrides } } };
}

test("delivery register gives unconfigured episodes one clear setup action", () => {
  assert.equal(getDeliveryRegisterState({ manifest: null }), "not_configured");
  assert.equal(getNextDeliveryAction({ manifest: null }), "Apply a delivery profile");
});

test("delivery register prioritises operational attention before ordinary progress", () => {
  assert.equal(getDeliveryRegisterState(entry({ hasDeliveryContactGaps: true })), "needs_attention");
  assert.equal(getNextDeliveryAction(entry({ hasDeliveryContactGaps: true })), "Choose a delivery recipient");
  assert.equal(getDeliveryRegisterState(entry({}, [{ label: "Textless master", required: true, status: "rejected" }])), "needs_attention");
  assert.equal(getNextDeliveryAction(entry({}, [{ label: "Textless master", required: true, status: "rejected" }])), "Resolve Textless master");
  assert.equal(getDeliveryRegisterState(entry({ deadlineRisk: "overdue" })), "needs_attention");
});

test("delivery register separates facility dispatch from recipient acceptance", () => {
  const dispatched = entry({ facilityDispatched: true }, [{ label: "5.1 mix", required: true, status: "dispatched" }]);
  assert.equal(getDeliveryRegisterState(dispatched), "dispatched");
  assert.equal(getNextDeliveryAction(dispatched), "Confirm receipt for 5.1 mix");

  const accepted = entry({ facilityDispatched: true, clientNetworkAccepted: true }, [{ label: "5.1 mix", required: true, status: "receipt_confirmed" }]);
  assert.equal(getDeliveryRegisterState(accepted), "accepted");
  assert.equal(getNextDeliveryAction(accepted), "Delivery complete");
});
