export const defaultEpisodicWorkflow = [
  { id: "demo-stage-1", key: "assembly_cut", name: "Assembly cut", position: 1 },
  { id: "demo-stage-2", key: "editor_cut", name: "Editor’s cut", position: 2 },
  { id: "demo-stage-3", key: "director_review", name: "Director’s cut / review", position: 3 },
  { id: "demo-stage-4", key: "producer_network_review", name: "Producer, studio & network review", position: 4 },
  { id: "demo-stage-5", key: "fine_cut_approvals", name: "Fine cut & final approvals", position: 5 },
  { id: "demo-stage-6", key: "picture_lock", name: "Picture lock", position: 6 },
  { id: "demo-stage-7", key: "vfx_graphics_titles", name: "VFX, graphics & titles", position: 7 },
  { id: "demo-stage-8", key: "colour_online_conform", name: "Colour grade / online conform", position: 8 },
  { id: "demo-stage-9", key: "sound_final_mix", name: "Sound edit, ADR, music & final mix", position: 9 },
  { id: "demo-stage-10", key: "quality_control", name: "Quality control (QC)", position: 10 },
  { id: "demo-stage-11", key: "mastering_delivery", name: "Mastering & delivery", position: 11 },
] as const;

const approvalPolicies = [
  [["editor", "Editor sign-off", true]],
  [["editor", "Editor sign-off", true]],
  [["director", "Director approval", true]],
  [["producer", "Producer approval", true], ["network", "Studio / network approval", false]],
  [["director", "Director approval", true], ["producer", "Producer approval", true]],
  [["post_supervisor", "Post supervisor lock approval", true], ["producer", "Producer lock approval", true], ["network", "Studio / network lock approval", false]],
  [["vfx_coordinator", "VFX coordinator sign-off", true], ["post_supervisor", "Post supervisor approval", true], ["director", "Director creative approval", false]],
  [["colorist", "Colourist completion", true], ["post_supervisor", "Post supervisor approval", true], ["director", "Director grade approval", false]],
  [["sound_mixer", "Sound mixer completion", true], ["post_supervisor", "Post supervisor approval", true], ["director", "Director sound approval", false]],
  [["qc", "QC operator sign-off", true], ["post_supervisor", "Post supervisor disposition", true]],
  [["post_supervisor", "Post supervisor delivery approval", true], ["network", "Network / streamer acceptance", false]],
] as const;

export const defaultEpisodicApprovalRules = approvalPolicies.flatMap((rules, stageIndex) => rules.map(([approverRole, label, isRequired], ruleIndex) => ({
  id: `demo-rule-${stageIndex + 1}-${ruleIndex + 1}`,
  workflowStageId: defaultEpisodicWorkflow[stageIndex].id,
  approverRole,
  label,
  approvalOrder: ruleIndex + 1,
  isRequired,
})));

export function statusForWorkflowKey(key: string) {
  if (key === "assembly_cut") return "assembly" as const;
  if (key === "editor_cut") return "editor_cut" as const;
  if (["director_review", "producer_network_review", "fine_cut_approvals"].includes(key)) return "review" as const;
  if (key === "picture_lock") return "locked" as const;
  if (key === "mastering_delivery") return "delivered" as const;
  if (["vfx_graphics_titles", "colour_online_conform", "sound_final_mix", "quality_control"].includes(key)) return "online" as const;
  return "development" as const;
}

export function defaultWorkflowStageForStatus(status: string) {
  const key = status === "assembly" ? "assembly_cut" : status === "editor_cut" ? "editor_cut" : status === "review" ? "producer_network_review" : status === "locked" ? "picture_lock" : status === "online" ? "colour_online_conform" : status === "delivered" ? "mastering_delivery" : "assembly_cut";
  return defaultEpisodicWorkflow.find((stage) => stage.key === key)!;
}
