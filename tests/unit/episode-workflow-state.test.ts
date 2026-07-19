import assert from "node:assert/strict";
import test from "node:test";

import { resolveCurrentEpisodeWorkflowState } from "../../src/lib/current-episode-workflow-state";

const stages = [
  { id: "assembly", name: "Assembly", position: 1 },
  { id: "editorial", name: "Editor's cut", position: 2 },
  { id: "review", name: "Client review", position: 3 },
];

test("current stage and lifecycle are the only live workflow state", () => {
  const state = resolveCurrentEpisodeWorkflowState({ workflowStageId: "editorial", workflowStatus: "in_progress", stages });
  assert.equal(state.displayStatus, "in_progress");
  assert.equal(state.primaryStageName, "Editor's cut");
  assert.equal(state.primaryStageId, "editorial");
});

test("awaiting sign-off and blocked states remain attached to the same current stage", () => {
  const awaiting = resolveCurrentEpisodeWorkflowState({ workflowStageId: "review", workflowStatus: "awaiting_sign_off", stages });
  const blocked = resolveCurrentEpisodeWorkflowState({ workflowStageId: "review", workflowStatus: "blocked", stages });
  assert.equal(awaiting.primaryStageId, "review");
  assert.match(awaiting.label, /Awaiting sign-off/);
  assert.equal(blocked.primaryStageId, "review");
  assert.match(blocked.label, /Blocked/);
});

test("complete is explicit and does not infer state from previous stages", () => {
  const state = resolveCurrentEpisodeWorkflowState({ workflowStageId: "review", workflowStatus: "complete", stages });
  assert.equal(state.displayStatus, "complete");
  assert.equal(state.primaryStageName, "Client review");
});

test("the resolver exposes one current-stage contract, not legacy graph or track state", () => {
  const state = resolveCurrentEpisodeWorkflowState({ workflowStageId: "assembly", workflowStatus: "not_started", stages });

  assert.deepEqual(Object.keys(state).sort(), ["displayStatus", "label", "primaryStageId", "primaryStageName"]);
  assert.equal("tracks" in state, false);
  assert.equal("dependencies" in state, false);
});

test("an invalid stage pointer cannot invent a current stage", () => {
  const state = resolveCurrentEpisodeWorkflowState({ workflowStageId: "foreign-stage", workflowStatus: "in_progress", stages });

  assert.equal(state.primaryStageId, null);
  assert.equal(state.primaryStageName, null);
  assert.equal(state.label, "Not started");
});
