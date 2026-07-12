const stages = [
  ["post_setup_delivery_specifications", "Post setup and delivery specifications", "post_supervisor"],
  ["ingest_verification_editorial_preparation", "Ingest, verification and editorial preparation", "assistant_editor"],
  ["assembly_cut", "Assembly cut", "editor"],
  ["editor_cut", "Editor’s cut", "editor"],
  ["director_review", "Director’s cut / review", "director"],
  ["producer_review", "Producer review", "producer"],
  ["studio_network_client_review", "Studio, network or client review", "network_client_executive"],
  ["legal_compliance_clearances", "Legal, compliance and clearances", "producer"],
  ["fine_cut_final_creative_approval", "Fine cut and final creative approval", "producer"],
  ["picture_lock", "Picture lock", "producer"],
  ["department_turnovers", "Department turnovers", "post_supervisor"],
  ["vfx_graphics_titles", "VFX, graphics and titles", "vfx_supervisor"],
  ["online_conform", "Online conform", "online_editor"],
  ["colour_grade", "Colour grade", "colorist"],
  ["sound_editorial_adr_foley_music", "Sound editorial, ADR, Foley and music", "supervising_sound_editor"],
  ["final_mix", "Final mix", "rerecording_mixer"],
  ["captions_localisation_accessibility", "Captions, localisation and accessibility", "post_supervisor"],
  ["mastering_versioning", "Mastering and versioning", "post_supervisor"],
  ["quality_control", "Quality control", "qc"],
  ["corrections_re_qc", "Corrections and re-QC", "qc"],
  ["delivery", "Delivery", "post_supervisor"],
  ["client_network_acceptance", "Client or network acceptance", "network_client_representative"],
  ["archive_closeout", "Archive and closeout", "post_supervisor"],
] as const;

export const defaultEpisodicWorkflow = stages.map(([key, name], index) => ({ id: `demo-stage-${index + 1}`, key, name, position: index + 1 }));

export const defaultEpisodicApprovalRules = stages.map(([, , approverRole], index) => ({
  id: `demo-rule-${index + 1}-1`, workflowStageId: defaultEpisodicWorkflow[index].id, approverRole, label: workflowSignOffLabel(approverRole), approvalOrder: 1, isRequired: true,
}));

export function workflowSignOffLabel(role: string) {
  return ({
    post_supervisor: "Post Supervisor sign-off", assistant_editor: "Assistant Editor sign-off", editor: "Editor sign-off", director: "Director sign-off", producer: "Producer sign-off", network_client_executive: "Network / Client Executive sign-off", vfx_supervisor: "VFX Supervisor sign-off", online_editor: "Online Editor sign-off", colorist: "Colourist sign-off", supervising_sound_editor: "Supervising Sound Editor sign-off", rerecording_mixer: "Re-recording Mixer sign-off", qc: "QC Operator sign-off", network_client_representative: "Network / Client Representative sign-off",
  } as Record<string, string>)[role] ?? `${role.replaceAll("_", " ")} sign-off`;
}

export function statusForWorkflowKey(key: string) {
  if (["post_setup_delivery_specifications", "ingest_verification_editorial_preparation", "assembly_cut"].includes(key)) return "assembly" as const;
  if (key === "editor_cut") return "editor_cut" as const;
  if (["director_review", "producer_review", "studio_network_client_review", "legal_compliance_clearances", "fine_cut_final_creative_approval"].includes(key)) return "review" as const;
  if (key === "picture_lock") return "locked" as const;
  if (["delivery", "client_network_acceptance", "archive_closeout"].includes(key)) return "delivered" as const;
  if (["department_turnovers", "vfx_graphics_titles", "online_conform", "colour_grade", "sound_editorial_adr_foley_music", "final_mix", "captions_localisation_accessibility", "mastering_versioning", "quality_control", "corrections_re_qc"].includes(key)) return "online" as const;
  return "development" as const;
}

export function defaultWorkflowStageForStatus(status: string) {
  const key = status === "assembly" ? "assembly_cut" : status === "editor_cut" ? "editor_cut" : status === "review" ? "producer_review" : status === "locked" ? "picture_lock" : status === "online" ? "online_conform" : status === "delivered" ? "delivery" : "post_setup_delivery_specifications";
  return defaultEpisodicWorkflow.find((stage) => stage.key === key)!;
}
