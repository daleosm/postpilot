import { expect, test } from "@playwright/test";

import { defaultEpisodicApprovalRules, defaultEpisodicWorkflow } from "@/lib/workflow";

test("the default Editor’s cut gate is signed off by an editor", () => {
  const editorCut = defaultEpisodicWorkflow.find((stage) => stage.key === "editor_cut");
  const rules = defaultEpisodicApprovalRules.filter((rule) => rule.workflowStageId === editorCut?.id);

  expect(rules).toEqual([expect.objectContaining({ approverRole: "editor", label: "Editor sign-off" })]);
});
