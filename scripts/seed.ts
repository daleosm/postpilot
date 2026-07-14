import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  activityLog,
  billables,
  bookings,
  budgetLines,
  cateringRequests,
  crmCompanies,
  crmContacts,
  episodeTeamAssignments,
  episodes,
  organizationMembers,
  organizations,
  organizationRolePolicies,
  people,
  purchaseOrders,
  purchaseOrderEvents,
  postWorkOrders,
  postWorkflows,
  qcIssues,
  qcReports,
  rateCardItems,
  rateCards,
  rooms,
  seasons,
  showContacts,
  serviceRates,
  shows,
  users,
  vendorInvoices,
  workflowStageApprovalRules,
  workflowStageWorkOrderTemplates,
  workflowStages,
} from "../src/lib/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required. Example: DATABASE_URL=postgres://... pnpm db:seed");

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

const seedOrganizationIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
] as const;

const stages = [
  ["Post setup and delivery specifications", "post_setup_delivery_specifications", "#71869a", "post_supervisor"],
  ["Ingest, verification and editorial preparation", "ingest_verification_editorial_preparation", "#5f7ee6", "assistant_editor"],
  ["Assembly cut", "assembly_cut", "#7b8eb3", "editor"],
  ["Editor’s cut", "editor_cut", "#5f7ee6", "editor"],
  ["Director’s cut / review", "director_review", "#9b70e5", "director"],
  ["Producer review", "producer_review", "#a7785d", "producer"],
  ["Studio, network or client review", "studio_network_client_review", "#9c6fb9", "network_client_executive"],
  ["Legal, compliance and clearances", "legal_compliance_clearances", "#977a67", "producer"],
  ["Fine cut and final creative approval", "fine_cut_final_creative_approval", "#c58a52", "producer"],
  ["Picture lock", "picture_lock", "#d99a45", "producer"],
  ["Department turnovers", "department_turnovers", "#8a8173", "post_supervisor"],
  ["VFX, graphics and titles", "vfx_graphics_titles", "#af7195", "vfx_supervisor"],
  ["Online conform", "online_conform", "#658da4", "online_editor"],
  ["Colour grade", "colour_grade", "#4d9687", "colorist"],
  ["Sound editorial, ADR, Foley and music", "sound_editorial_adr_foley_music", "#56889a", "supervising_sound_editor"],
  ["Final mix", "final_mix", "#4d7b8d", "rerecording_mixer"],
  ["Captions, localisation and accessibility", "captions_localisation_accessibility", "#7c8c78", "post_supervisor"],
  ["Mastering and versioning", "mastering_versioning", "#647c70", "post_supervisor"],
  ["Quality control", "quality_control", "#b56d54", "qc"],
  ["Corrections and re-QC", "corrections_re_qc", "#bd7650", "qc"],
  ["Delivery", "delivery", "#607b70", "post_supervisor"],
  ["Client or network acceptance", "client_network_acceptance", "#8c719d", "network_client_representative"],
  ["Archive and closeout", "archive_closeout", "#6d7671", "post_supervisor"],
] as const;

type PersonRole = string;
type MembershipRole = "owner" | "admin" | "member" | "guest";
type PersonSeed = { name: string; email: string; role: PersonRole; userId?: string; membershipRole?: MembershipRole; isFreelancer?: boolean };
type TenantSeed = {
  number: number;
  id: (typeof seedOrganizationIds)[number];
  name: string;
  slug: string;
  workflowName: string;
  workflowDescription: string;
  networks: string[];
  shows: Array<{ title: string; code: string; company: string; episodes: string[] }>;
  roomNames: [string, string, string, string, string];
  people: PersonSeed[];
  budgetProfile: { currency: string; multiplier: number; vendor: string };
};

const specialistRoleSeeds: Array<{ role: PersonRole; title: string }> = [
  { role: "online_editor", title: "Online Editor" },
  { role: "vfx_supervisor", title: "VFX Supervisor" },
  { role: "supervising_sound_editor", title: "Supervising Sound Editor" },
  { role: "rerecording_mixer", title: "Re-recording Mixer" },
  { role: "network_client_executive", title: "Network Client Executive" },
  { role: "network_client_representative", title: "Network Client Representative" },
];

const defaultRolePolicies: Record<string, string[]> = {
  post_supervisor: ["manage_shows", "manage_bookings", "manage_reviews", "approve_reviews", "approve_time", "manage_work_orders", "update_assigned_work", "manage_qc", "waive_qc", "manage_budget", "manage_users", "request_catering", "view_assigned"],
  producer: ["manage_shows", "manage_bookings", "manage_reviews", "approve_reviews", "approve_time", "manage_work_orders", "update_assigned_work", "manage_qc", "waive_qc", "manage_budget", "manage_users", "request_catering", "view_assigned"],
  head_of_production: ["manage_shows", "manage_bookings", "manage_work_orders", "manage_budget", "request_catering", "view_assigned"],
  finance: ["manage_budget", "approve_time", "approve_budget_overruns", "manage_rates", "approve_rate_overrides", "approve_po_overruns", "view_assigned"],
  runner: ["request_catering", "manage_catering", "view_assigned"],
  qc: ["update_assigned_work", "manage_qc", "verify_qc", "request_catering", "view_assigned"],
  editor: ["update_assigned_work", "request_catering", "view_assigned"],
  assistant_editor: ["update_assigned_work", "request_catering", "view_assigned"],
  online_editor: ["update_assigned_work", "request_catering", "view_assigned"],
  colorist: ["update_assigned_work", "request_catering", "view_assigned"],
  sound_mixer: ["update_assigned_work", "request_catering", "view_assigned"],
  supervising_sound_editor: ["update_assigned_work", "request_catering", "view_assigned"],
  rerecording_mixer: ["update_assigned_work", "request_catering", "view_assigned"],
  vfx_coordinator: ["update_assigned_work", "request_catering", "view_assigned"],
  vfx_supervisor: ["update_assigned_work", "request_catering", "view_assigned"],
  director: ["approve_reviews", "view_assigned"],
  network_client_executive: ["approve_reviews", "view_assigned"],
  network_client_representative: ["approve_reviews", "view_assigned"],
  client: ["approve_reviews", "view_assigned"],
};

function roleLabel(role: string) { return role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

const tenants: TenantSeed[] = [
  {
    number: 1,
    id: seedOrganizationIds[0],
    name: "Northstar Post",
    slug: "northstar-post",
    workflowName: "Northstar Drama Delivery",
    workflowDescription: "London scripted drama workflow with network lock reviews and HDR delivery gates.",
    networks: ["Northstar Network", "N5", "BritView"],
    shows: [
      { title: "Signal North", code: "SN", company: "Vantage Television", episodes: ["The Quiet Hour", "Second Skin", "Tin Roof", "Borrowed Light"] },
      { title: "Blackwater", code: "BW", company: "Hollow Tree", episodes: ["Wake", "The Rook", "The Still", "Good Soil"] },
      { title: "The Long View", code: "LV", company: "Beacon Drama", episodes: ["North Window", "Dead Signal", "Low Cloud", "Last Light"] },
    ],
    roomNames: ["Avid Bay 01", "Avid Bay 02", "Luma Grade", "Stage North", "Technical QC 1"],
    people: [
      { name: "Maya Ortiz", email: "maya@postpilot.debug", role: "post_supervisor", userId: "user_maya", membershipRole: "admin" },
      { name: "Nadia Kane", email: "nadia@northstar-post.test", role: "producer", userId: "user_nadia", membershipRole: "member" },
      { name: "James Liu", email: "james@northstar-post.test", role: "editor", userId: "user_james", membershipRole: "member" },
      { name: "Leah Morgan", email: "leah@northstar-post.test", role: "assistant_editor", userId: "user_leah", membershipRole: "member" },
      { name: "Avery Stone", email: "avery@northstar-post.test", role: "colorist" },
      { name: "Noah Chen", email: "noah@northstar-post.test", role: "sound_mixer", userId: "user_noah", membershipRole: "member" },
      { name: "Ruth Okafor", email: "ruth@northstar-post.test", role: "qc", userId: "user_ruth", membershipRole: "member" },
      { name: "Vik Grant", email: "vik@northstar-post.test", role: "vfx_coordinator" },
      { name: "Mara Voss", email: "mara@northstar-post.test", role: "director", userId: "user_mara", membershipRole: "guest" },
      { name: "Iman Patel", email: "iman@northstar-post.test", role: "finance", userId: "user_iman", membershipRole: "member" },
      { name: "Jules Reed", email: "jules@northstar-post.test", role: "runner" },
      { name: "Northstar Network Review", email: "review@northstar-network.test", role: "client" },
    ],
    budgetProfile: { currency: "USD", multiplier: 1, vendor: "Poppy VFX" },
  },
  {
    number: 2,
    id: seedOrganizationIds[1],
    name: "Riverside Post",
    slug: "riverside-post",
    workflowName: "Riverside Premium Series",
    workflowDescription: "Waterfront facility workflow with stream-platform review rounds, Dolby mix sign-off, and nightly delivery checks.",
    networks: ["StreamWave", "Harbour+", "Channel Eight", "Alto", "Mosaic"],
    shows: [
      { title: "Harbour Line", code: "HL", company: "Tideway Studios", episodes: ["Low Water", "Pilot Light", "Channel Mark", "Winter Mooring"] },
      { title: "The Reed House", code: "RH", company: "Saltbox Pictures", episodes: ["The Lease", "Paper Walls", "After Dinner", "The Key Safe"] },
      { title: "North Quay", code: "NQ", company: "Ferryhouse Films", episodes: ["Tide Table", "Red Flag", "Crossing", "Breakwater"] },
      { title: "Common Ground", code: "CG", company: "Eider Pictures", episodes: ["The Orchard", "Half Acre", "Boundary Line", "The Gate"] },
      { title: "Hinterland Unit", code: "HU", company: "Skyline Workshop", episodes: ["Wayfinder", "Dry Dock", "The Beacon", "After Rain"] },
    ],
    roomNames: ["Cutting Room Alder", "Cutting Room Birch", "Northlight Colour", "Dockside Mix", "Harbour QC"],
    people: [
      { name: "Maya Ortiz", email: "maya@postpilot.debug", role: "post_supervisor", userId: "user_maya", membershipRole: "admin" },
      { name: "Briony Vale", email: "briony@riverside-post.test", role: "producer" },
      { name: "Tessa Ward", email: "tessa@riverside-post.test", role: "editor" },
      { name: "Cal Porter", email: "cal@riverside-post.test", role: "assistant_editor" },
      { name: "Oona Bell", email: "oona@riverside-post.test", role: "colorist" },
      { name: "Eli Bennett", email: "eli@riverside-post.test", role: "sound_mixer", userId: "user_eli", membershipRole: "member" },
      { name: "Harriet Cole", email: "harriet@riverside-post.test", role: "qc" },
      { name: "Mina Saleh", email: "mina@riverside-post.test", role: "vfx_coordinator" },
      { name: "Lloyd Finch", email: "lloyd@riverside-post.test", role: "director" },
      { name: "Amal Webb", email: "amal@riverside-post.test", role: "finance" },
      { name: "Sam Walker", email: "sam@riverside-post.test", role: "runner", userId: "user_sam", membershipRole: "member" },
      { name: "Casey Reed", email: "casey@client.test", role: "client", userId: "user_casey", membershipRole: "guest" },
    ],
    budgetProfile: { currency: "GBP", multiplier: 0.78, vendor: "Meridian Graphics" },
  },
  {
    number: 3,
    id: seedOrganizationIds[2],
    name: "Horizon Finish",
    slug: "horizon-finish",
    workflowName: "Horizon High-End Finish",
    workflowDescription: "Finishing-led workflow for premium scripted series: creative lock, VFX handoff, Dolby Atmos mix, and platform mastering.",
    networks: ["ArcTV", "Global Screen"],
    shows: [
      { title: "Glass District", code: "GD", company: "Kestrel Drama", episodes: ["Refraction", "Blind Corner", "Clear View", "The Atrium"] },
      { title: "Salt & Static", code: "SS", company: "Wavelength Films", episodes: ["Dead Air", "Crossfade", "Signal Loss", "Night Shift"] },
    ],
    roomNames: ["Atlas Edit One", "Atlas Edit Two", "Prism Colour", "Atmos Theatre", "Horizon QC Lab"],
    people: [
      { name: "Maya Ortiz", email: "maya@postpilot.debug", role: "post_supervisor", userId: "user_maya", membershipRole: "admin" },
      { name: "Delia Grant", email: "delia@horizon-finish.test", role: "producer" },
      { name: "Alex Grant", email: "alex@horizon-finish.test", role: "editor", userId: "user_alex", membershipRole: "member" },
      { name: "Mori Vale", email: "mori@horizon-finish.test", role: "assistant_editor" },
      { name: "Priya Shah", email: "priya@horizon-finish.test", role: "colorist", userId: "user_priya", membershipRole: "member" },
      { name: "Soren Pike", email: "soren@horizon-finish.test", role: "sound_mixer" },
      { name: "Yasmin Rowe", email: "yasmin@horizon-finish.test", role: "qc" },
      { name: "Ivo March", email: "ivo@horizon-finish.test", role: "vfx_coordinator" },
      { name: "Anika Ford", email: "anika@horizon-finish.test", role: "director" },
      { name: "Rey Nash", email: "rey@horizon-finish.test", role: "finance" },
      { name: "Kit Lo", email: "kit@horizon-finish.test", role: "runner" },
      { name: "ArcTV Review", email: "review@arctv.test", role: "client" },
    ],
    budgetProfile: { currency: "EUR", multiplier: 0.92, vendor: "Aurora VFX" },
  },
  {
    number: 4,
    id: seedOrganizationIds[3],
    name: "Lantern Post House",
    slug: "lantern-post-house",
    workflowName: "Lantern Returning Drama",
    workflowDescription: "High-volume returning drama workflow with split editorial teams, rapid producer reviews, and broadcaster masters.",
    networks: ["Meridian", "North One", "VistaPlay", "Crown", "Beacon", "Freeview+", "DramaBox"],
    shows: [
      { title: "City of Ash", code: "CA", company: "Lantern Originals", episodes: ["Smoke Test", "First Siren", "Open Window", "Black Rain"] },
      { title: "Parallel Lines", code: "PL", company: "Kite String", episodes: ["Platform 4", "Signal Box", "Last Train", "The Junction"] },
      { title: "Wild Harbour", code: "WH", company: "West Coast Films", episodes: ["Grey Seal", "Low Bell", "Riptide", "Safe Water"] },
      { title: "Old School", code: "OS", company: "Pencil Case", episodes: ["Roll Call", "The Assembly", "Lost Property", "After Hours"] },
      { title: "The Empty Room", code: "ER", company: "Candlelight", episodes: ["Keyholder", "South Wall", "The Mirror", "No Exit"] },
      { title: "Summer Street", code: "SU", company: "Rook & Rose", episodes: ["Heatwave", "Open Door", "The Shortcut", "Street Party"] },
      { title: "Paper Trail", code: "PT", company: "Red Folder", episodes: ["Archive", "The Witness", "Carbon Copy", "Final Draft"] },
    ],
    roomNames: ["Lantern Edit A", "Lantern Edit B", "Firelight Grade", "Candle Mix", "Lantern QC"],
    people: [
      { name: "Maya Ortiz", email: "maya@postpilot.debug", role: "post_supervisor", userId: "user_maya", membershipRole: "admin" },
      { name: "Omar Dale", email: "omar@lantern-post.test", role: "producer", userId: "user_lantern_producer", membershipRole: "member" },
      { name: "Freya Moss", email: "freya@lantern-post.test", role: "editor", userId: "user_lantern_editor", membershipRole: "member" },
      { name: "Theo Grant", email: "theo@lantern-post.test", role: "assistant_editor" },
      { name: "Mina Cross", email: "mina@lantern-post.test", role: "colorist" },
      { name: "Kieran Holt", email: "kieran@lantern-post.test", role: "sound_mixer" },
      { name: "Suki Wells", email: "suki@lantern-post.test", role: "qc" },
      { name: "Rae Nolan", email: "rae@lantern-post.test", role: "vfx_coordinator" },
      { name: "Jo Bell", email: "jo@lantern-post.test", role: "director" },
      { name: "Priya Dean", email: "priya.dean@lantern-post.test", role: "finance", userId: "user_lantern_finance", membershipRole: "member" },
      { name: "Finn Cole", email: "finn@lantern-post.test", role: "runner", userId: "user_lantern_runner", membershipRole: "member" },
      { name: "Meridian Review", email: "review@meridian.test", role: "client", userId: "user_lantern_client", membershipRole: "guest" },
    ],
    budgetProfile: { currency: "GBP", multiplier: 0.88, vendor: "Lantern Screen VFX" },
  },
  {
    number: 5,
    id: seedOrganizationIds[4],
    name: "Copperline Editorial",
    slug: "copperline-editorial",
    workflowName: "Copperline Limited Series",
    workflowDescription: "Boutique limited-series workflow with compact suites, director-led reviews, and platform delivery sign-off.",
    networks: ["Slate+", "Helix", "Brightline", "WestNet"],
    shows: [
      { title: "Crossing Point", code: "CP", company: "Copperline Pictures", episodes: ["Westbound", "The Toll", "Night Ferry", "Home Shore"] },
      { title: "Northern Static", code: "NS", company: "Cold Frame", episodes: ["Relay", "The Mast", "White Noise", "Dead Air"] },
      { title: "The Seawall", code: "SW", company: "Breakline Media", episodes: ["Foundation", "High Tide", "The Breach", "Rebuild"] },
      { title: "Small Hours", code: "SH", company: "Hourglass", episodes: ["01:13", "03:40", "04:55", "Dawn"] },
    ],
    roomNames: ["Copper Cut 1", "Copper Cut 2", "Verdigris Grade", "Foundry Mix", "Copper QC"],
    people: [
      { name: "Maya Ortiz", email: "maya@postpilot.debug", role: "post_supervisor", userId: "user_maya", membershipRole: "admin" },
      { name: "Lena Hart", email: "lena@copperline.test", role: "producer", userId: "user_copper_producer", membershipRole: "member" },
      { name: "Mark Dyer", email: "mark@copperline.test", role: "editor", userId: "user_copper_editor", membershipRole: "member" },
      { name: "Elle Fraser", email: "elle@copperline.test", role: "assistant_editor" },
      { name: "Tariq Moon", email: "tariq@copperline.test", role: "colorist" },
      { name: "Nell Sharp", email: "nell@copperline.test", role: "sound_mixer" },
      { name: "Amir Gold", email: "amir@copperline.test", role: "qc" },
      { name: "Veda Cole", email: "veda@copperline.test", role: "vfx_coordinator" },
      { name: "Isa Rowe", email: "isa@copperline.test", role: "director" },
      { name: "Peter Vale", email: "peter@copperline.test", role: "finance", userId: "user_copper_finance", membershipRole: "member" },
      { name: "Nia Park", email: "nia@copperline.test", role: "runner", userId: "user_copper_runner", membershipRole: "member" },
      { name: "Slate+ Review", email: "review@slateplus.test", role: "client", userId: "user_copper_client", membershipRole: "guest" },
    ],
    budgetProfile: { currency: "USD", multiplier: 1.18, vendor: "Copperline VFX" },
  },
];

const id = (tenant: number, kind: string, value: number) => `${`${kind}${tenant}`.padEnd(8, "0")}-0000-4000-8000-${String(value).padStart(12, "0")}`;
const at = (daysFromToday: number, hour: number, minutes = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  value.setHours(hour, minutes, 0, 0);
  return value;
};
const day = (daysFromToday: number) => at(daysFromToday, 12).toISOString().slice(0, 10);

const globalUsers = [
  ["user_maya", "Maya Ortiz", "maya@postpilot.debug"],
  ["user_nadia", "Nadia Kane", "nadia@northstar-post.test"],
  ["user_james", "James Liu", "james@northstar-post.test"],
  ["user_leah", "Leah Morgan", "leah@northstar-post.test"],
  ["user_priya", "Priya Shah", "priya@horizon-finish.test"],
  ["user_eli", "Eli Bennett", "eli@riverside-post.test"],
  ["user_ruth", "Ruth Okafor", "ruth@northstar-post.test"],
  ["user_noah", "Noah Chen", "noah@northstar-post.test"],
  ["user_mara", "Mara Voss", "mara@northstar-post.test"],
  ["user_sam", "Sam Walker", "sam@riverside-post.test"],
  ["user_alex", "Alex Grant", "alex@horizon-finish.test"],
  ["user_iman", "Iman Patel", "iman@northstar-post.test"],
  ["user_casey", "Casey Reed", "casey@client.test"],
  ["user_lantern_producer", "Omar Dale", "omar@lantern-post.test"],
  ["user_lantern_editor", "Freya Moss", "freya@lantern-post.test"],
  ["user_lantern_finance", "Priya Dean", "priya.dean@lantern-post.test"],
  ["user_lantern_runner", "Finn Cole", "finn@lantern-post.test"],
  ["user_lantern_client", "Meridian Review", "review@meridian.test"],
  ["user_copper_producer", "Lena Hart", "lena@copperline.test"],
  ["user_copper_editor", "Mark Dyer", "mark@copperline.test"],
  ["user_copper_finance", "Peter Vale", "peter@copperline.test"],
  ["user_copper_runner", "Nia Park", "nia@copperline.test"],
  ["user_copper_client", "Slate+ Review", "review@slateplus.test"],
] as const;

async function seedTenant(tenant: TenantSeed) {
  const workflowId = id(tenant.number, "21", 1);
  const stageId = (position: number) => id(tenant.number, "22", position);
  const ruleId = (position: number) => id(tenant.number, "23", position);
  const personId = (position: number) => id(tenant.number, "24", position);
  const showId = (position: number) => id(tenant.number, "25", position);
  const seasonId = (position: number) => id(tenant.number, "26", position);
  const episodeId = (position: number) => id(tenant.number, "27", position);
  const roomId = (position: number) => id(tenant.number, "28", position);
  const bookingId = (position: number) => id(tenant.number, "29", position);
  const companyId = (position: number) => id(tenant.number, "42", position);
  const contactId = (position: number) => id(tenant.number, "43", position);
  // Each facility person has a tenant-local Auth.js identity and membership.
  // Maya is intentionally the only shared debug platform administrator.
  const sourcePeople: PersonSeed[] = [...tenant.people, ...specialistRoleSeeds.map((specialist, index) => ({ name: `${tenant.name} ${specialist.title}`, email: `${specialist.role}.${index + 1}@${tenant.slug}.test`, role: specialist.role, isFreelancer: true }))];
  const tenantPeople = sourcePeople.map((person, index) => ({
    ...person,
    userId: person.userId ?? `user_${tenant.slug.replaceAll("-", "_")}_${index + 1}`,
    membershipRole: person.membershipRole ?? (person.role === "client" || person.role === "director" ? "guest" : "member") as MembershipRole,
  }));
  const byRole = (role: PersonRole) => personId(tenantPeople.findIndex((person) => person.role === role) + 1);
  const primaryNetwork = tenant.networks[0] ?? "Distribution";
  const secondaryNetwork = tenant.networks[1] ?? primaryNetwork;

  await db.insert(organizations).values({ id: tenant.id, name: tenant.name, slug: tenant.slug });
  await db.insert(users).values(tenantPeople.map((person) => ({ id: person.userId, name: person.name, email: person.email }))).onConflictDoUpdate({ target: users.id, set: { name: sql`excluded.name`, email: sql`excluded.email` } });
  await db.insert(organizationMembers).values(tenantPeople.map((person) => ({ organizationId: tenant.id, userId: person.userId, role: person.membershipRole })));
  await db.insert(people).values(tenantPeople.map((person, index) => ({
    id: personId(index + 1), organizationId: tenant.id, name: person.name, email: person.email, role: person.role, userId: person.userId,
    availability: (index % 5 === 0 ? "limited" : "available") as "limited" | "available", isFreelancer: person.isFreelancer ?? false, hourlyRate: String(65 + index * 8), dayRate: String(520 + index * 55),
  })));
  await db.insert(organizationRolePolicies).values([...new Set(tenantPeople.map((person) => person.role))].map((role) => ({ organizationId: tenant.id, role, label: roleLabel(role), permissions: defaultRolePolicies[role] ?? [] })));

  await db.insert(postWorkflows).values({ id: workflowId, organizationId: tenant.id, name: tenant.workflowName, description: tenant.workflowDescription, isDefault: true });
  await db.insert(workflowStages).values(stages.map(([name, key, color], index) => ({ id: stageId(index + 1), organizationId: tenant.id, workflowId, name, key, color, position: index + 1, isTerminal: key === "archive_closeout" })));
  await db.insert(workflowStageApprovalRules).values(stages.map(([, , , approverRole], index) => ({ id: ruleId(index + 1), organizationId: tenant.id, workflowStageId: stageId(index + 1), approverRole, label: `${approverRole.replaceAll("_", " ")} sign-off`, approvalOrder: 1, isRequired: true })));
  await db.insert(workflowStageWorkOrderTemplates).values([
    { id: id(tenant.number, "37", 1), organizationId: tenant.id, workflowStageId: stageId(12), title: "Confirm VFX, graphics and titles turnover", department: "VFX", assigneeRole: "vfx_coordinator", priority: "normal", isBlocking: false, position: 1 },
    { id: id(tenant.number, "37", 2), organizationId: tenant.id, workflowStageId: stageId(16), title: "Print final 5.1, stereo and M&E mixes", department: "Sound", assigneeRole: "sound_mixer", priority: "blocker", isBlocking: true, position: 1 },
    { id: id(tenant.number, "37", 3), organizationId: tenant.id, workflowStageId: stageId(19), title: "Run technical QC and log exceptions", department: "QC", assigneeRole: "qc", priority: "blocker", isBlocking: true, position: 1 },
  ]);

  await db.insert(crmCompanies).values([
    { id: companyId(1), organizationId: tenant.id, name: primaryNetwork, type: "network", address: "1 Broadcast Square, London", paymentTermsDays: 30, currency: tenant.budgetProfile.currency, financeEmail: `finance@${tenant.slug}.client.test`, billingEmail: `accounts@${tenant.slug}.client.test`, accountStatus: "active" },
    { id: companyId(2), organizationId: tenant.id, name: tenant.shows[0]?.company ?? `${tenant.name} Productions`, type: "production_company", address: "42 Production Way, London", paymentTermsDays: 30, currency: tenant.budgetProfile.currency, financeEmail: `finance@${tenant.slug}.production.test`, accountStatus: "active" },
    { id: companyId(3), organizationId: tenant.id, name: `${tenant.name} Facilities Vendor`, type: "vendor", address: "18 Vendor Park, London", serviceCategory: "Finishing, QC & localisation", isPreferredSupplier: true, paymentTermsDays: 14, currency: tenant.budgetProfile.currency, financeEmail: `accounts@${tenant.slug}.vendor.test`, accountStatus: "active" },
  ]);
  await db.insert(crmContacts).values([
    { id: contactId(1), organizationId: tenant.id, companyId: companyId(1), name: `${primaryNetwork} Post Executive`, title: "Post Executive", email: `post@${tenant.slug}.client.test`, phone: "+44 20 7000 1001", contactType: "creative_approval", isPrimary: true },
    { id: contactId(2), organizationId: tenant.id, companyId: companyId(1), name: `${primaryNetwork} Delivery Desk`, title: "Technical Delivery Manager", email: `delivery@${tenant.slug}.client.test`, phone: "+44 20 7000 1002", contactType: "technical_delivery" },
    { id: contactId(3), organizationId: tenant.id, companyId: companyId(1), name: `${primaryNetwork} Finance`, title: "Accounts Payable", email: `finance@${tenant.slug}.client.test`, phone: "+44 20 7000 1003", contactType: "finance" },
    { id: contactId(4), organizationId: tenant.id, companyId: companyId(1), name: `${primaryNetwork} Legal`, title: "Business Affairs Counsel", email: `legal@${tenant.slug}.client.test`, phone: "+44 20 7000 1004", contactType: "legal" },
    { id: contactId(5), organizationId: tenant.id, companyId: companyId(1), name: `${primaryNetwork} Review Office`, title: "Client Review Coordinator", email: `review@${tenant.slug}.client.test`, phone: "+44 20 7000 1005", contactType: "client_review" },
  ]);

  await db.insert(shows).values(tenant.shows.map((show, index) => ({ id: showId(index + 1), organizationId: tenant.id, title: show.title, code: show.code, network: tenant.networks[index] ?? primaryNetwork, productionCompany: show.company, clientCompanyId: companyId(1), productionCompanyId: companyId(2), timeZone: "Europe/London" })));
  await db.insert(showContacts).values(tenant.shows.flatMap((_, index) => [
    { organizationId: tenant.id, showId: showId(index + 1), contactId: contactId(1), responsibility: "creative_approvals" as const, relationship: "creative approval", isApprovalContact: true },
    { organizationId: tenant.id, showId: showId(index + 1), contactId: contactId(2), responsibility: "delivery_qc" as const, relationship: "delivery and QC", isApprovalContact: false },
    { organizationId: tenant.id, showId: showId(index + 1), contactId: contactId(3), responsibility: "finance_po" as const, relationship: "finance and PO", isApprovalContact: false },
    { organizationId: tenant.id, showId: showId(index + 1), contactId: contactId(4), responsibility: "legal_compliance" as const, relationship: "legal and compliance", isApprovalContact: false },
  ]));
  await db.insert(purchaseOrders).values([{ id: id(tenant.number, "44", 1), organizationId: tenant.id, companyId: companyId(3), showId: showId(1), poNumber: `${tenant.slug.toUpperCase().replaceAll("-", "")}-PO-001`, kind: "vendor_commitment", amount: String(8500 * tenant.budgetProfile.multiplier), consumedAmount: "0", currency: tenant.budgetProfile.currency, expiresAt: day(45), status: "open", notes: "Approved external finishing and QC contingency." }, { id: id(tenant.number, "44", 2), organizationId: tenant.id, companyId: companyId(1), showId: showId(1), poNumber: `${tenant.slug.toUpperCase().replaceAll("-", "")}-AUTH-001`, kind: "client_authorisation", amount: String(24000 * tenant.budgetProfile.multiplier), consumedAmount: "0", currency: tenant.budgetProfile.currency, expiresAt: day(60), status: "open", notes: "Client-authorised network notes and versioning scope." }]);
  await db.insert(seasons).values(tenant.shows.map((show, index) => ({ id: seasonId(index + 1), organizationId: tenant.id, showId: showId(index + 1), number: 1, title: `${show.title} · Season 1`, startDate: day(-100 + index * 18) })));
  const lifecyclePatterns = [
    ["editor_cut", "in_progress", 4],
    ["review", "not_started", 6],
    ["locked", "passed", 10],
    ["online", "needs_attention", 13],
    ["assembly", "not_started", 3],
    ["delivered", "passed", 21],
    ["review", "needs_attention", 7],
    ["locked", "in_progress", 10],
  ] as const;
  const episodeRows = tenant.shows.flatMap((show, showIndex) => show.episodes.map((title, episodeIndex) => {
    const position = showIndex * 4 + episodeIndex + 1;
    const lifecycle = lifecyclePatterns[(position - 1) % lifecyclePatterns.length] as ["development" | "assembly" | "editor_cut" | "review" | "locked" | "online" | "delivered", "not_started" | "in_progress" | "passed" | "needs_attention", number];
    return {
      id: episodeId(position), organizationId: tenant.id, seasonId: seasonId(showIndex + 1), workflowStageId: stageId(lifecycle[2]),
      number: episodeIndex + 1, productionCode: `${show.code}10${episodeIndex + 1}`, title, synopsis: `${title} enters the ${tenant.name} post pipeline.`,
      status: lifecycle[0], qcStatus: lifecycle[1], assignedProducerId: byRole("producer"), editorId: byRole("editor"), coloristId: byRole("colorist"), soundMixerId: byRole("sound_mixer"),
      airDate: day(25 + position * 7), lockedCutDate: day(-4 + position * 2), deliveryDeadline: at(3 + position * 2, 17),
    };
  }));
  await db.insert(episodes).values(episodeRows);
  await db.update(purchaseOrders).set({ episodeId: episodeId(1) }).where(inArray(purchaseOrders.id, [id(tenant.number, "44", 1), id(tenant.number, "44", 2)]));
  await db.insert(episodeTeamAssignments).values(episodeRows.flatMap((episode, index) => {
    const roles = ["producer", "editor", "assistant_editor"];
    if (["locked", "online", "delivered"].includes(episode.status)) roles.push("colorist", "sound_mixer");
    if (index % 3 === 0) roles.push("qc");
    return roles.map((role) => ({ organizationId: tenant.id, episodeId: episode.id, personId: byRole(role), responsibility: role }));
  }));

  await db.insert(rooms).values([
    { id: roomId(1), organizationId: tenant.id, name: tenant.roomNames[0], type: "edit_bay", location: "Editorial floor", capacity: 3 },
    { id: roomId(2), organizationId: tenant.id, name: tenant.roomNames[1], type: "edit_bay", location: "Editorial floor", capacity: 3 },
    { id: roomId(3), organizationId: tenant.id, name: tenant.roomNames[2], type: "color_suite", location: "Finishing floor", capacity: 5 },
    { id: roomId(4), organizationId: tenant.id, name: tenant.roomNames[3], type: "mix_room", location: "Sound floor", capacity: 8 },
    { id: roomId(5), organizationId: tenant.id, name: tenant.roomNames[4], type: "qc_room", location: "Delivery floor", capacity: 4 },
  ]);
  await db.insert(bookings).values([
    { id: bookingId(1), organizationId: tenant.id, roomId: roomId(1), episodeId: episodeId(1), personId: byRole("editor"), title: `${episodeRows[0].productionCode} editorial block`, startsAt: at(0, 9), endsAt: at(1, 18), setupMinutes: 15, handoverMinutes: 15, strikeMinutes: 0, status: "confirmed", bookingType: "edit", notes: "Two-day editorial booking; client links remain external." },
    { id: bookingId(2), organizationId: tenant.id, roomId: roomId(3), episodeId: episodeId(4), personId: byRole("colorist"), title: `${episodeRows[3].productionCode} grade pass`, startsAt: at(1, 9), endsAt: at(2, 18), setupMinutes: 45, handoverMinutes: 15, strikeMinutes: 30, status: "confirmed", bookingType: "color", notes: "Finishing review references are maintained in notes." },
    { id: bookingId(3), organizationId: tenant.id, roomId: roomId(4), episodeId: episodeId(7), personId: byRole("sound_mixer"), title: `${episodeRows[6].productionCode} final mix`, startsAt: at(2, 10), endsAt: at(3, 19), setupMinutes: 30, handoverMinutes: 30, strikeMinutes: 30, status: "confirmed", bookingType: "mix" },
    { id: bookingId(4), organizationId: tenant.id, roomId: roomId(5), episodeId: episodeId(4), personId: byRole("qc"), title: `${episodeRows[3].productionCode} technical QC`, startsAt: at(3, 9), endsAt: at(3, 16), setupMinutes: 30, handoverMinutes: 0, strikeMinutes: 15, status: "confirmed", bookingType: "qc" },
    { id: bookingId(5), organizationId: tenant.id, roomId: roomId(2), episodeId: episodeId(8), personId: byRole("editor"), title: `${episodeRows[7].productionCode} lock notes`, startsAt: at(4, 9), endsAt: at(4, 18), status: "hold", bookingType: "edit" },
    { id: bookingId(6), organizationId: tenant.id, personId: byRole("assistant_editor"), title: "Approved leave — assistant editorial", startsAt: at(5, 9), endsAt: at(6, 18), status: "confirmed", bookingType: "leave", notes: "Approved annual leave. No room or episode is reserved." },
    { id: bookingId(7), organizationId: tenant.id, personId: byRole("colorist"), title: "Colour finishing training", startsAt: at(2, 9), endsAt: at(2, 17), status: "confirmed", bookingType: "training", notes: "Facility training day; unavailable for project bookings." },
    { id: bookingId(8), organizationId: tenant.id, personId: byRole("sound_mixer"), title: "Unavailable — external commitment", startsAt: at(4, 9), endsAt: at(4, 18), status: "confirmed", bookingType: "unavailable", notes: "External commitment recorded as a personnel booking." },
  ]);
  await db.insert(cateringRequests).values([
    { id: id(tenant.number, "2a", 1), organizationId: tenant.id, bookingId: bookingId(1), roomId: roomId(1), requestedByPersonId: byRole("editor"), fulfilledByPersonId: byRole("runner"), requestType: "lunch", item: tenant.number === 2 ? "Miso aubergine bowl" : tenant.number === 3 ? "Herb focaccia and soup" : "Chicken Caesar salad", quantity: 1, requestedFor: at(0, 13), status: "preparing", currency: tenant.budgetProfile.currency },
    { id: id(tenant.number, "2a", 2), organizationId: tenant.id, bookingId: bookingId(3), roomId: roomId(4), requestedByPersonId: byRole("sound_mixer"), requestType: "tea_coffee", item: "Oat flat white", quantity: 2, notes: "One decaf", requestedFor: at(2, 11), status: "acknowledged", currency: tenant.budgetProfile.currency },
  ]);

  await db.insert(qcReports).values([{ id: id(tenant.number, "33", 1), organizationId: tenant.id, episodeId: episodeId(4), status: "failed", summary: "Flash-frame and caption timing failures require a corrected post package.", completedAt: at(-1, 16) }]);
  await db.insert(qcIssues).values([{ id: id(tenant.number, "34", 1), organizationId: tenant.id, qcReportId: id(tenant.number, "33", 1), code: "PHOTOSENS-01", severity: "high", description: "Photosensitivity warning at transition; regrade and rerun external QC.", timecodeSeconds: "1817.700", status: "open" }]);
  await db.insert(postWorkOrders).values([
    { id: id(tenant.number, "38", 1), organizationId: tenant.id, episodeId: episodeId(1), workflowStageId: stageId(4), vendorCompanyId: companyId(3), purchaseOrderId: id(tenant.number, "44", 1), title: "External caption and QC package", description: "Vendor brief for caption correction and technical QC support.", department: "Delivery", assigneePersonId: byRole("assistant_editor"), assigneeRole: "assistant_editor", priority: "high", isBlocking: false, status: "in_progress", billingScope: "internal", estimatedAmount: (2750 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, externalUrl: "https://example.com/vendor-brief" },
    { id: id(tenant.number, "38", 2), organizationId: tenant.id, episodeId: episodeId(4), workflowStageId: stageId(13), qcIssueId: id(tenant.number, "34", 1), kind: "qc_exception", title: "QC exception — correct photosensitivity transition", description: "Photosensitivity warning at 00:30:17.700. Regrade, document the correction, then return to QC.", department: "Online", assigneePersonId: byRole("online_editor"), assigneeRole: "online_editor", priority: "blocker", isBlocking: true, status: "open", externalUrl: "https://example.com/qc-report" },
  ]);

  const budgetCategories = ["Edit suite", "Editorial artists", "VFX", "Colour", "Sound", "QC", "Finalisation"];
  await db.insert(budgetLines).values(budgetCategories.map((category, index) => {
    const base = (index + 1) * 12500 * tenant.budgetProfile.multiplier;
    return { id: id(tenant.number, "30", index + 1), organizationId: tenant.id, showId: showId(index % tenant.shows.length + 1), seasonId: seasonId(index % tenant.shows.length + 1), episodeId: episodeId(index + 1), code: `POST-${String(index + 1).padStart(2, "0")}`, category, description: `${category} profile for ${tenant.name}`, budgetedAmount: base.toFixed(2), actualAmount: (base * (index === 2 ? 1.12 : 0.86 + (index % 3) * 0.05)).toFixed(2), currency: tenant.budgetProfile.currency, costType: (index % 2 ? "internal" : "billable") as "internal" | "billable" };
  }));
  const vendorInvoiceAmount = 2750 * tenant.budgetProfile.multiplier;
  await db.insert(vendorInvoices).values([{ id: id(tenant.number, "47", 1), organizationId: tenant.id, vendorCompanyId: companyId(3), purchaseOrderId: id(tenant.number, "44", 1), workOrderId: id(tenant.number, "38", 1), showId: showId(1), episodeId: episodeId(1), invoiceNumber: `${tenant.slug.toUpperCase()}-V-001`, description: "External QC and finishing support", amount: vendorInvoiceAmount.toFixed(2), currency: tenant.budgetProfile.currency, status: "approved", invoiceDate: day(-3), dueDate: day(12) }]);
  await db.insert(budgetLines).values([{ id: id(tenant.number, "30", 99), organizationId: tenant.id, showId: showId(1), seasonId: seasonId(1), episodeId: episodeId(1), vendorInvoiceId: id(tenant.number, "47", 1), purchaseOrderId: id(tenant.number, "44", 1), code: "VENDOR-INV-001", category: "Vendor invoice", description: "External QC and finishing support", budgetedAmount: "0", actualAmount: vendorInvoiceAmount.toFixed(2), currency: tenant.budgetProfile.currency, costType: "internal" }]);
  await db.insert(serviceRates).values([
    { id: id(tenant.number, "36", 1), organizationId: tenant.id, name: "Edit bay", category: "Edit suite", unit: "day", rate: (760 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Standard staffed edit-bay day." },
    { id: id(tenant.number, "36", 2), organizationId: tenant.id, name: "Senior editor", category: "Editorial artists", unit: "day", rate: (690 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Standard editorial day rate." },
    { id: id(tenant.number, "36", 3), organizationId: tenant.id, name: "Colour grade", category: "Colour", unit: "day", rate: (980 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Suite and colourist." },
    { id: id(tenant.number, "36", 4), organizationId: tenant.id, name: "Final mix", category: "Sound", unit: "day", rate: (1120 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Mix room and mixer." },
    { id: id(tenant.number, "36", 5), organizationId: tenant.id, name: "Technical QC", category: "QC", unit: "episode", rate: (485 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "External technical QC pass." },
    { id: id(tenant.number, "36", 6), organizationId: tenant.id, name: "VFX turnover", category: "VFX", unit: "fixed", rate: (3200 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Per-episode vendor coordination allowance." },
  ]);
  await db.insert(rateCards).values([{ id: id(tenant.number, "45", 1), organizationId: tenant.id, clientCompanyId: companyId(1), network: primaryNetwork, name: `${primaryNetwork} network rate card`, currency: tenant.budgetProfile.currency, isActive: true }, { id: id(tenant.number, "45", 2), organizationId: tenant.id, showId: showId(1), name: `${tenant.shows[0].title} show override`, currency: tenant.budgetProfile.currency, isActive: true }, { id: id(tenant.number, "45", 3), organizationId: tenant.id, episodeId: episodeId(1), name: `${episodeRows[0].productionCode} episode override`, currency: tenant.budgetProfile.currency, isActive: true }]);
  await db.insert(rateCardItems).values([{ id: id(tenant.number, "46", 1), organizationId: tenant.id, rateCardId: id(tenant.number, "45", 1), serviceRateId: id(tenant.number, "36", 3), category: "Colour", unit: "day", rate: (930 * tenant.budgetProfile.multiplier).toFixed(2) }, { id: id(tenant.number, "46", 2), organizationId: tenant.id, rateCardId: id(tenant.number, "45", 2), serviceRateId: id(tenant.number, "36", 1), category: "Edit suite", unit: "day", rate: (720 * tenant.budgetProfile.multiplier).toFixed(2) }, { id: id(tenant.number, "46", 3), organizationId: tenant.id, rateCardId: id(tenant.number, "45", 3), serviceRateId: id(tenant.number, "36", 5), category: "QC", unit: "episode", rate: (525 * tenant.budgetProfile.multiplier).toFixed(2) }]);
  const clientBillableAmount = 18400 * tenant.budgetProfile.multiplier;
  await db.insert(billables).values([{ id: id(tenant.number, "31", 1), organizationId: tenant.id, showId: showId(1), episodeId: episodeId(4), purchaseOrderId: id(tenant.number, "44", 2), vendor: tenant.budgetProfile.vendor, reference: `${tenant.shows[0].code}-PO-021`, description: "Finishing and clearance support", amount: clientBillableAmount.toFixed(2), currency: tenant.budgetProfile.currency, status: "approved", invoiceDate: day(-5), dueDate: day(18) }]);
  await db.update(purchaseOrders).set({ consumedAmount: vendorInvoiceAmount.toFixed(2) }).where(eq(purchaseOrders.id, id(tenant.number, "44", 1)));
  await db.update(purchaseOrders).set({ consumedAmount: clientBillableAmount.toFixed(2) }).where(eq(purchaseOrders.id, id(tenant.number, "44", 2)));
  await db.insert(purchaseOrderEvents).values([
    { id: id(tenant.number, "48", 1), organizationId: tenant.id, purchaseOrderId: id(tenant.number, "44", 1), actorUserId: tenantPeople.find((person) => person.role === "finance")?.userId ?? null, action: "vendor_invoice.recorded", amount: vendorInvoiceAmount.toFixed(2), metadata: { source: "seeded vendor invoice", invoiceId: id(tenant.number, "47", 1) } },
    { id: id(tenant.number, "48", 2), organizationId: tenant.id, purchaseOrderId: id(tenant.number, "44", 2), actorUserId: tenantPeople.find((person) => person.role === "finance")?.userId ?? null, action: "allocation.client_billable", amount: clientBillableAmount.toFixed(2), metadata: { source: "seeded client billable", billableId: id(tenant.number, "31", 1) } },
  ]);
  await db.insert(activityLog).values([
    { id: id(tenant.number, "32", 1), organizationId: tenant.id, actorUserId: tenantPeople.find((person) => person.role === "post_supervisor")?.userId, action: "episode.picture_lock_approved", entityType: "episode", entityId: episodeId(3), metadata: { workflow: tenant.workflowName, status: "approved" } },
    { id: id(tenant.number, "32", 2), organizationId: tenant.id, actorUserId: tenantPeople.find((person) => person.role === "qc")?.userId, action: "qc.issue_created", entityType: "episode", entityId: episodeId(4), metadata: { issueCount: 1, risk: "high" } },
    { id: id(tenant.number, "32", 3), organizationId: tenant.id, actorUserId: tenantPeople.find((person) => person.role === "producer")?.userId, action: "workflow.changes_requested", entityType: "episode", entityId: episodeId(7), metadata: { network: secondaryNetwork } },
    { id: id(tenant.number, "32", 4), organizationId: tenant.id, actorUserId: tenantPeople.find((person) => person.role === "post_supervisor")?.userId, action: "workflow.finalised", entityType: "episode", entityId: episodeId(6), metadata: { destination: secondaryNetwork } },
  ]);
}

async function seed() {
  // Explicit seed runs rebuild only the five known fixture organizations. All
  // other organizations and global Auth.js users are left untouched. Between
  // seed runs, every edit is ordinary persistent PostgreSQL data.
  await db.delete(organizations).where(inArray(organizations.id, [...seedOrganizationIds]));
  // Removed fixture identity from the former single-tenant seed. All remaining
  // seeded users have exactly one tenant membership, except Maya by design.
  await db.delete(users).where(eq(users.id, "user_iris"));
  await db.insert(users).values(globalUsers.map(([id, name, email]) => ({ id, name, email }))).onConflictDoUpdate({ target: users.id, set: { name: sql`excluded.name`, email: sql`excluded.email` } });
  for (const tenant of tenants) await seedTenant(tenant);
  const showCount = tenants.reduce((total, tenant) => total + tenant.shows.length, 0);
  const episodeCount = tenants.reduce((total, tenant) => total + tenant.shows.reduce((showsTotal, show) => showsTotal + show.episodes.length, 0), 0);
  console.log(`Seeded ${tenants.length} isolated PostPilot post houses with ${showCount} shows, ${episodeCount} episodes, tenant-specific workflows, bookings, work orders, budgets, catering, QC, and activity.`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
