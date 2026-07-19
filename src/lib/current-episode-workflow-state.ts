export type CurrentEpisodeWorkflowStatus = "not_started" | "in_progress" | "awaiting_sign_off" | "blocked" | "complete";

export type CurrentWorkflowStage = { id: string; name: string; position: number };

export type CurrentEpisodeWorkflowState = {
  displayStatus: CurrentEpisodeWorkflowStatus;
  label: string;
  primaryStageId: string | null;
  primaryStageName: string | null;
};

/** Resolves the live state from exactly one episode stage and lifecycle. */
export function resolveCurrentEpisodeWorkflowState(input: {
  workflowStageId: string | null;
  workflowStatus: CurrentEpisodeWorkflowStatus;
  stages: readonly CurrentWorkflowStage[];
}): CurrentEpisodeWorkflowState {
  const stages = [...input.stages].sort((left, right) => left.position - right.position);
  const current = stages.find((stage) => stage.id === input.workflowStageId) ?? null;
  const label = input.workflowStatus === "awaiting_sign_off"
    ? `Awaiting sign-off · ${current?.name ?? "workflow"}`
    : input.workflowStatus === "blocked"
      ? `Blocked · ${current?.name ?? "workflow"}`
      : input.workflowStatus === "complete"
        ? "Complete"
        : current?.name ?? "Not started";

  return {
    displayStatus: input.workflowStatus,
    label,
    primaryStageId: current?.id ?? null,
    primaryStageName: current?.name ?? null,
  };
}
