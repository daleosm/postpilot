import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  activityLog,
  billables,
  bookings,
  budgetLines,
  cateringRequests,
  clientShares,
  episodes,
  organizationMembers,
  organizations,
  people,
  postWorkflows,
  qcIssues,
  qcReports,
  rooms,
  seasons,
  serviceRates,
  showTeamAssignments,
  shows,
  tasks,
  users,
  workflowStageApprovalRules,
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
  ["Assembly cut", "assembly_cut", "#71869a", "editor"],
  ["Editor’s cut", "editor_cut", "#5f7ee6", "post_supervisor"],
  ["Director’s cut / review", "director_review", "#9b70e5", "director"],
  ["Producer, studio & network review", "producer_network_review", "#9c6fb9", "producer"],
  ["Fine cut & final approvals", "fine_cut_approvals", "#c58a52", "producer"],
  ["Picture lock", "picture_lock", "#d99a45", "post_supervisor"],
  ["VFX, graphics & titles", "vfx_graphics_titles", "#af7195", "vfx_coordinator"],
  ["Colour grade / online conform", "colour_online_conform", "#4d9687", "colorist"],
  ["Sound edit, ADR, music & final mix", "sound_final_mix", "#56889a", "sound_mixer"],
  ["Quality control (QC)", "quality_control", "#b56d54", "qc"],
  ["Mastering & delivery", "mastering_delivery", "#647c70", "post_supervisor"],
] as const;

type PersonRole = "producer" | "post_supervisor" | "finance" | "editor" | "assistant_editor" | "colorist" | "sound_mixer" | "vfx_coordinator" | "qc" | "director" | "client" | "runner";
type MembershipRole = "owner" | "admin" | "member" | "guest";
type PersonSeed = { name: string; email: string; role: PersonRole; userId?: string; membershipRole?: MembershipRole };
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
  // Each facility person has a tenant-local Auth.js identity and membership.
  // Maya is intentionally the only shared debug platform administrator.
  const tenantPeople = tenant.people.map((person, index) => ({
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
    availability: (index % 5 === 0 ? "limited" : "available") as "limited" | "available", hourlyRate: String(65 + index * 8), dayRate: String(520 + index * 55),
  })));

  await db.insert(postWorkflows).values({ id: workflowId, organizationId: tenant.id, name: tenant.workflowName, description: tenant.workflowDescription, isDefault: true });
  await db.insert(workflowStages).values(stages.map(([name, key, color], index) => ({ id: stageId(index + 1), organizationId: tenant.id, workflowId, name, key, color, position: index + 1, isTerminal: key === "mastering_delivery" })));
  await db.insert(workflowStageApprovalRules).values(stages.map(([, , , approverRole], index) => ({ id: ruleId(index + 1), organizationId: tenant.id, workflowStageId: stageId(index + 1), approverRole, label: `${approverRole.replaceAll("_", " ")} sign-off`, approvalOrder: 1, isRequired: true })));

  await db.insert(shows).values(tenant.shows.map((show, index) => ({ id: showId(index + 1), organizationId: tenant.id, title: show.title, code: show.code, network: tenant.networks[index] ?? primaryNetwork, productionCompany: show.company, timeZone: "Europe/London" })));
  await db.insert(seasons).values(tenant.shows.map((show, index) => ({ id: seasonId(index + 1), organizationId: tenant.id, showId: showId(index + 1), number: 1, title: `${show.title} · Season 1`, startDate: day(-100 + index * 18) })));
  await db.insert(showTeamAssignments).values(tenant.shows.flatMap((_, showIndex) => tenantPeople
    .filter((person) => !["finance", "runner", "client"].includes(person.role))
    .map((_, personIndex) => ({ organizationId: tenant.id, showId: showId(showIndex + 1), personId: personId(personIndex + 1) }))));

  const lifecyclePatterns = [
    ["editor_cut", "in_progress", 2],
    ["review", "not_started", 4],
    ["locked", "passed", 6],
    ["online", "needs_attention", 8],
    ["assembly", "not_started", 1],
    ["delivered", "passed", 11],
    ["review", "needs_attention", 4],
    ["locked", "in_progress", 6],
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

  await db.insert(rooms).values([
    { id: roomId(1), organizationId: tenant.id, name: tenant.roomNames[0], type: "edit_bay", location: "Editorial floor", capacity: 3 },
    { id: roomId(2), organizationId: tenant.id, name: tenant.roomNames[1], type: "edit_bay", location: "Editorial floor", capacity: 3 },
    { id: roomId(3), organizationId: tenant.id, name: tenant.roomNames[2], type: "color_suite", location: "Finishing floor", capacity: 5 },
    { id: roomId(4), organizationId: tenant.id, name: tenant.roomNames[3], type: "mix_room", location: "Sound floor", capacity: 8 },
    { id: roomId(5), organizationId: tenant.id, name: tenant.roomNames[4], type: "qc_room", location: "Delivery floor", capacity: 4 },
  ]);
  await db.insert(bookings).values([
    { id: bookingId(1), organizationId: tenant.id, roomId: roomId(1), episodeId: episodeId(1), personId: byRole("editor"), title: `${episodeRows[0].productionCode} editorial block`, startsAt: at(0, 9), endsAt: at(1, 18), status: "confirmed", bookingType: "edit", notes: "Two-day editorial booking; client links remain external." },
    { id: bookingId(2), organizationId: tenant.id, roomId: roomId(3), episodeId: episodeId(4), personId: byRole("colorist"), title: `${episodeRows[3].productionCode} grade pass`, startsAt: at(1, 9), endsAt: at(2, 18), status: "confirmed", bookingType: "color", notes: "Finishing review references are maintained in notes." },
    { id: bookingId(3), organizationId: tenant.id, roomId: roomId(4), episodeId: episodeId(7), personId: byRole("sound_mixer"), title: `${episodeRows[6].productionCode} final mix`, startsAt: at(2, 10), endsAt: at(3, 19), status: "confirmed", bookingType: "mix" },
    { id: bookingId(4), organizationId: tenant.id, roomId: roomId(5), episodeId: episodeId(4), personId: byRole("qc"), title: `${episodeRows[3].productionCode} technical QC`, startsAt: at(3, 9), endsAt: at(3, 16), status: "confirmed", bookingType: "qc" },
    { id: bookingId(5), organizationId: tenant.id, roomId: roomId(2), episodeId: episodeId(8), personId: byRole("editor"), title: `${episodeRows[7].productionCode} lock notes`, startsAt: at(4, 9), endsAt: at(4, 18), status: "hold", bookingType: "edit" },
  ]);
  await db.insert(cateringRequests).values([
    { id: id(tenant.number, "2a", 1), organizationId: tenant.id, bookingId: bookingId(1), roomId: roomId(1), requestedByPersonId: byRole("editor"), fulfilledByPersonId: byRole("runner"), requestType: "lunch", item: tenant.number === 2 ? "Miso aubergine bowl" : tenant.number === 3 ? "Herb focaccia and soup" : "Chicken Caesar salad", quantity: 1, requestedFor: at(0, 13), status: "preparing" },
    { id: id(tenant.number, "2a", 2), organizationId: tenant.id, bookingId: bookingId(3), roomId: roomId(4), requestedByPersonId: byRole("sound_mixer"), requestType: "tea_coffee", item: "Oat flat white", quantity: 2, notes: "One decaf", requestedFor: at(2, 11), status: "acknowledged" },
  ]);

  const client = byRole("client");
  await db.insert(clientShares).values([
    { id: id(tenant.number, "35", 1), organizationId: tenant.id, clientPersonId: client, episodeId: episodeId(2), canApprove: tenant.number === 2, createdByUserId: tenantPeople.find((person) => person.role === "post_supervisor")?.userId },
  ]);
  await db.insert(qcReports).values([{ id: id(tenant.number, "33", 1), organizationId: tenant.id, episodeId: episodeId(4), status: "failed", summary: "Flash-frame and caption timing failures require a corrected post package.", completedAt: at(-1, 16) }]);
  await db.insert(qcIssues).values([{ id: id(tenant.number, "34", 1), organizationId: tenant.id, qcReportId: id(tenant.number, "33", 1), code: "PHOTOSENS-01", severity: "high", description: "Photosensitivity warning at transition; regrade and rerun external QC.", timecodeSeconds: "1817.700", status: "open" }]);

  await db.insert(tasks).values([
    { id: id(tenant.number, "2f", 1), organizationId: tenant.id, showId: showId(1), episodeId: episodeId(1), workflowStageId: stageId(2), assigneeId: byRole("editor"), createdByUserId: tenantPeople.find((person) => person.role === "post_supervisor")?.userId, title: "Address producer note at 25:34", status: "in_progress", priority: "high", dueAt: at(1, 16) },
    { id: id(tenant.number, "2f", 2), organizationId: tenant.id, showId: showId(2), episodeId: episodeId(4), workflowStageId: stageId(10), assigneeId: byRole("qc"), createdByUserId: tenantPeople.find((person) => person.role === "post_supervisor")?.userId, title: "Clear technical QC exception", status: "blocked", priority: "urgent", dueAt: at(2, 12) },
  ]);
  const budgetCategories = ["Edit suite", "Editorial artists", "VFX", "Colour", "Sound", "QC", "Finalisation"];
  await db.insert(budgetLines).values(budgetCategories.map((category, index) => {
    const base = (index + 1) * 12500 * tenant.budgetProfile.multiplier;
    return { id: id(tenant.number, "30", index + 1), organizationId: tenant.id, showId: showId(index % tenant.shows.length + 1), seasonId: seasonId(index % tenant.shows.length + 1), episodeId: episodeId(index + 1), code: `POST-${String(index + 1).padStart(2, "0")}`, category, description: `${category} profile for ${tenant.name}`, budgetedAmount: base.toFixed(2), actualAmount: (base * (index === 2 ? 1.12 : 0.86 + (index % 3) * 0.05)).toFixed(2), currency: tenant.budgetProfile.currency, costType: (index % 2 ? "internal" : "billable") as "internal" | "billable" };
  }));
  await db.insert(serviceRates).values([
    { id: id(tenant.number, "36", 1), organizationId: tenant.id, name: "Edit bay", category: "Edit suite", unit: "day", rate: (760 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Standard staffed edit-bay day." },
    { id: id(tenant.number, "36", 2), organizationId: tenant.id, name: "Senior editor", category: "Editorial artists", unit: "day", rate: (690 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Standard editorial day rate." },
    { id: id(tenant.number, "36", 3), organizationId: tenant.id, name: "Colour grade", category: "Colour", unit: "day", rate: (980 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Suite and colourist." },
    { id: id(tenant.number, "36", 4), organizationId: tenant.id, name: "Final mix", category: "Sound", unit: "day", rate: (1120 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Mix room and mixer." },
    { id: id(tenant.number, "36", 5), organizationId: tenant.id, name: "Technical QC", category: "QC", unit: "episode", rate: (485 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "External technical QC pass." },
    { id: id(tenant.number, "36", 6), organizationId: tenant.id, name: "VFX turnover", category: "VFX", unit: "fixed", rate: (3200 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, notes: "Per-episode vendor coordination allowance." },
  ]);
  await db.insert(billables).values([{ id: id(tenant.number, "31", 1), organizationId: tenant.id, showId: showId(1), episodeId: episodeId(4), vendor: tenant.budgetProfile.vendor, reference: `${tenant.shows[0].code}-PO-021`, description: "Finishing and clearance support", amount: (18400 * tenant.budgetProfile.multiplier).toFixed(2), currency: tenant.budgetProfile.currency, status: "approved", invoiceDate: day(-5), dueDate: day(18) }]);
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
  console.log(`Seeded ${tenants.length} isolated PostPilot post houses with ${showCount} shows, ${episodeCount} episodes, tenant-specific workflows, bookings, reviews, delivery, budgets, catering, QC, and activity.`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
