type CurrentEpisodeWorkflowStatus = "not_started" | "in_progress" | "awaiting_sign_off" | "blocked" | "complete";

const labels: Record<CurrentEpisodeWorkflowStatus, string> = {
  not_started: "Ready to start",
  in_progress: "In progress",
  awaiting_sign_off: "Awaiting sign-off",
  blocked: "Blocked",
  complete: "Complete",
};

const tones: Record<CurrentEpisodeWorkflowStatus, string> = {
  not_started: "pp-status--neutral",
  in_progress: "pp-status--active",
  awaiting_sign_off: "pp-status--warning",
  blocked: "pp-status--danger",
  complete: "pp-status--success",
};

/** The one visual treatment for the server-derived episode workflow state. */
export function WorkflowStateBadge({ status, className = "" }: { status: CurrentEpisodeWorkflowStatus | string; className?: string }) {
  const normalized = status as CurrentEpisodeWorkflowStatus;
  const label = labels[normalized] ?? status.replaceAll("_", " ");
  const tone = tones[normalized] ?? tones.not_started;
  return <span className={`pp-status ${tone} ${className}`}>{label}</span>;
}
