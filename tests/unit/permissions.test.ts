import assert from "node:assert/strict";
import test from "node:test";

import { clientRolePolicy, normalizePermission, normalizePermissions, permissions, policyGrants } from "../../src/lib/permissions-core";

test("every current capability is accepted without remapping", () => {
  for (const permission of permissions) assert.equal(normalizePermission(permission), permission);
});

test("each capability grants only itself to an internal policy", () => {
  for (const granted of permissions) {
    for (const requested of permissions) {
      assert.equal(policyGrants(requested, "member", [granted]), requested === granted, `${granted} must not grant ${requested}`);
    }
  }
});

test("legacy permission names resolve to their intended grouped capability", () => {
  assert.equal(normalizePermission("manage_shows"), "manage_production");
  assert.equal(normalizePermission("update_assigned_work"), "do_assigned_work");
  assert.equal(normalizePermission("sign_off_workflow_stages"), "sign_off_work");
  assert.equal(normalizePermission("verify_qc"), "manage_qc_delivery");
  assert.equal(normalizePermission("manage_budget"), "manage_commercial");
  assert.equal(normalizePermission("manage_catering"), "manage_catering");
});

test("policy normalization drops unknown values and removes duplicates", () => {
  assert.deepEqual(normalizePermissions(["manage_shows", "manage_production", "unknown_permission", "manage_production"]), ["manage_production"]);
  assert.equal(normalizePermission("unknown_permission"), null);
});

test("a client membership is fixed to sign-off access regardless of its person policy", () => {
  assert.deepEqual(clientRolePolicy.permissions, ["sign_off_work"]);
  assert.equal(policyGrants("sign_off_workflow_stages", "client", ["manage_production", "manage_commercial"]), true);
  assert.equal(policyGrants("manage_shows", "client", ["manage_production"]), false);
  assert.equal(policyGrants("manage_budget", "client", ["manage_commercial"]), false);
});

test("an internal tenant policy grants only the requested normalized capability", () => {
  assert.equal(policyGrants("manage_shows", "member", ["manage_production"]), true);
  assert.equal(policyGrants("manage_budget", "member", ["manage_production"]), false);
  assert.equal(policyGrants("view_all_operations", "member", ["view_all_operations"]), true);
  assert.equal(policyGrants("manage_shows", "member", []), false);
});
