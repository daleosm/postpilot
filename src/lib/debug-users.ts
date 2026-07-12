export const DEBUG_USER_COOKIE = "postpilot.debugUser";

export type DebugUser = {
  id: string;
  userId: string;
  name: string;
  role: string;
  label: string;
  tenantSlug?: string;
};

export const debugUsers: readonly DebugUser[] = [
  { id: "debug-maya", userId: "user_maya", name: "Maya Ortiz", role: "post_supervisor", label: "Platform admin · all tenants" },
  { id: "debug-nadia", userId: "user_nadia", name: "Nadia Kane", role: "producer", label: "Producer", tenantSlug: "northstar-post" },
  { id: "debug-james", userId: "user_james", name: "James Liu", role: "editor", label: "Editor", tenantSlug: "northstar-post" },
  { id: "debug-ruth", userId: "user_ruth", name: "Ruth Okafor", role: "qc", label: "QC Operator", tenantSlug: "northstar-post" },
  { id: "debug-iman", userId: "user_iman", name: "Iman Patel", role: "finance", label: "Finance", tenantSlug: "northstar-post" },
  { id: "debug-mara", userId: "user_mara", name: "Mara Voss", role: "director", label: "Director", tenantSlug: "northstar-post" },
  { id: "debug-eli", userId: "user_eli", name: "Eli Bennett", role: "sound_mixer", label: "Sound Mixer", tenantSlug: "riverside-post" },
  { id: "debug-sam", userId: "user_sam", name: "Sam Walker", role: "runner", label: "Runner", tenantSlug: "riverside-post" },
  { id: "debug-client", userId: "user_casey", name: "Casey Reed", role: "client", label: "Client Reviewer", tenantSlug: "riverside-post" },
  { id: "debug-alex", userId: "user_alex", name: "Alex Grant", role: "editor", label: "Editor", tenantSlug: "horizon-finish" },
  { id: "debug-priya", userId: "user_priya", name: "Priya Shah", role: "colorist", label: "Colorist", tenantSlug: "horizon-finish" },
  { id: "debug-omar", userId: "user_lantern_producer", name: "Omar Dale", role: "producer", label: "Producer", tenantSlug: "lantern-post-house" },
  { id: "debug-freya", userId: "user_lantern_editor", name: "Freya Moss", role: "editor", label: "Editor", tenantSlug: "lantern-post-house" },
  { id: "debug-priya-dean", userId: "user_lantern_finance", name: "Priya Dean", role: "finance", label: "Finance", tenantSlug: "lantern-post-house" },
  { id: "debug-finn", userId: "user_lantern_runner", name: "Finn Cole", role: "runner", label: "Runner", tenantSlug: "lantern-post-house" },
  { id: "debug-meridian", userId: "user_lantern_client", name: "Meridian Review", role: "client", label: "Client Reviewer", tenantSlug: "lantern-post-house" },
  { id: "debug-lena", userId: "user_copper_producer", name: "Lena Hart", role: "producer", label: "Producer", tenantSlug: "copperline-editorial" },
  { id: "debug-mark", userId: "user_copper_editor", name: "Mark Dyer", role: "editor", label: "Editor", tenantSlug: "copperline-editorial" },
  { id: "debug-peter", userId: "user_copper_finance", name: "Peter Vale", role: "finance", label: "Finance", tenantSlug: "copperline-editorial" },
  { id: "debug-nia", userId: "user_copper_runner", name: "Nia Park", role: "runner", label: "Runner", tenantSlug: "copperline-editorial" },
  { id: "debug-slate", userId: "user_copper_client", name: "Slate+ Review", role: "client", label: "Client Reviewer", tenantSlug: "copperline-editorial" },
];

export function findDebugUser(id?: string) {
  return debugUsers.find((user) => user.id === id) ?? debugUsers[0];
}
