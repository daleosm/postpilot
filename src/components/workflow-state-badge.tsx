type CurrentEpisodeWorkflowStatus = "not_started" | "in_progress" | "awaiting_sign_off" | "blocked" | "complete";

const labels: Record<CurrentEpisodeWorkflowStatus, string> = {
  not_started: "Ready to start",
  in_progress: "In progress",
  awaiting_sign_off: "Awaiting sign-off",
  blocked: "Blocked",
  complete: "Complete",
};

const tones: Record<CurrentEpisodeWorkflowStatus, string> = {
  not_started: "bg-[#edf0ed] text-[#68746e]",
  in_progress: "bg-[#dcebe4] text-[#356d58]",
  awaiting_sign_off: "bg-[#f6eddc] text-[#8b6232]",
  blocked: "bg-[#f8e7df] text-[#a45f43]",
  complete: "bg-[#e2eee6] text-[#3d7160]",
};

/** The one visual treatment for the server-derived episode workflow state. */
export function WorkflowStateBadge({ status, className = "" }: { status: CurrentEpisodeWorkflowStatus | string; className?: string }) {
  const normalized = status as CurrentEpisodeWorkflowStatus;
  const label = labels[normalized] ?? status.replaceAll("_", " ");
  const tone = tones[normalized] ?? tones.not_started;
  return <span className={`inline-flex max-w-full items-center rounded-full px-2 py-1 text-[10px] font-semibold ${tone} ${className}`}>{label}</span>;
}
