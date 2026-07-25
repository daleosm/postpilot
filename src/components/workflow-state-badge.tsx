type CurrentEpisodeWorkflowStatus = "not_started" | "in_progress" | "awaiting_sign_off" | "blocked" | "complete";

const labels: Record<CurrentEpisodeWorkflowStatus, string> = {
  not_started: "Ready to start",
  in_progress: "In progress",
  awaiting_sign_off: "Awaiting sign-off",
  blocked: "Blocked",
  complete: "Complete",
};

const tones: Record<CurrentEpisodeWorkflowStatus, "neutral" | "active" | "warning" | "danger" | "success"> = {
  not_started: "neutral",
  in_progress: "active",
  awaiting_sign_off: "warning",
  blocked: "danger",
  complete: "success",
};

/** The one visual treatment for the server-derived episode workflow state. */
export function WorkflowStateBadge({ status, className = "" }: { status: CurrentEpisodeWorkflowStatus | string; className?: string }) {
  const normalized = status as CurrentEpisodeWorkflowStatus;
  const label = labels[normalized] ?? status.replaceAll("_", " ");
  const tone = tones[normalized] ?? tones.not_started;
  return <StatusChip label={label} tone={tone} className={className} />;
}
import { StatusChip } from "@/components/operations-ui";
