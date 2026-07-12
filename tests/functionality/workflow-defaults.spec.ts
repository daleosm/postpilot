import { expect, test } from "@playwright/test";

import { defaultEpisodicApprovalRules, defaultEpisodicWorkflow } from "@/lib/workflow";

test("the default workflow contains the complete TV post sign-off pipeline", () => {
  const editorCut = defaultEpisodicWorkflow.find((stage) => stage.key === "editor_cut");
  const delivery = defaultEpisodicWorkflow.find((stage) => stage.key === "delivery");
  const clientAcceptance = defaultEpisodicWorkflow.find((stage) => stage.key === "client_network_acceptance");
  const rules = defaultEpisodicApprovalRules.filter((rule) => rule.workflowStageId === editorCut?.id);

  expect(defaultEpisodicWorkflow).toHaveLength(23);
  expect(defaultEpisodicWorkflow.map((stage) => stage.name)).toEqual(expect.arrayContaining(["Ingest, verification and editorial preparation", "Online conform", "Final mix", "Archive and closeout"]));
  expect(rules).toEqual([expect.objectContaining({ approverRole: "editor", label: "Editor sign-off" })]);
  expect(defaultEpisodicApprovalRules.find((rule) => rule.workflowStageId === delivery?.id)).toEqual(expect.objectContaining({ approverRole: "post_supervisor" }));
  expect(defaultEpisodicApprovalRules.find((rule) => rule.workflowStageId === clientAcceptance?.id)).toEqual(expect.objectContaining({ approverRole: "network_client_representative" }));
});
