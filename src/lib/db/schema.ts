import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const organizationRole = pgEnum("organization_role", ["owner", "admin", "member", "guest"]);
export const episodeStatus = pgEnum("episode_status", ["development", "assembly", "editor_cut", "review", "locked", "online", "delivered"]);
export const qcStatus = pgEnum("qc_status", ["not_started", "in_progress", "passed", "needs_attention", "waived"]);
export const personRole = pgEnum("person_role", ["producer", "post_supervisor", "head_of_production", "finance", "editor", "assistant_editor", "online_editor", "colorist", "sound_mixer", "supervising_sound_editor", "rerecording_mixer", "vfx_coordinator", "vfx_supervisor", "qc", "director", "network", "network_client_executive", "network_client_representative", "client", "runner", "freelancer"]);
export const bookingStatus = pgEnum("booking_status", ["tentative", "confirmed", "hold", "cancelled"]);
export const bookingType = pgEnum("booking_type", ["edit", "color", "mix", "qc", "client_review", "ingest", "conform"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "changes_requested"]);
export const billableStatus = pgEnum("billable_status", ["draft", "approved", "invoiced", "paid", "void"]);
export const costType = pgEnum("cost_type", ["billable", "internal"]);
export const availabilityStatus = pgEnum("availability_status", ["available", "limited", "booked_out", "away"]);
export const workflowTrackStatus = pgEnum("workflow_track_status", ["not_started", "in_progress", "submitted", "approved", "changes_requested", "blocked"]);
export const qcReportStatus = pgEnum("qc_report_status", ["draft", "in_progress", "passed", "failed", "waived"]);
export const qcIssueStatus = pgEnum("qc_issue_status", ["open", "resolved", "waived"]);
export const cateringRequestType = pgEnum("catering_request_type", ["lunch", "tea_coffee", "snack"]);
export const cateringRequestStatus = pgEnum("catering_request_status", ["requested", "acknowledged", "preparing", "delivered", "cancelled"]);

/** Auth.js adapter tables */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  ...auditColumns,
});

export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })]);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
}, (table) => [index("sessions_user_id_idx").on(table.userId)]);

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.identifier, table.token] })]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  logoUrl: text("logo_url"),
  ...auditColumns,
}, (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)]);

export const organizationMembers = pgTable("organization_members", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: organizationRole("role").default("member").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.userId] }),
  index("organization_members_user_id_idx").on(table.userId),
]);

/** Tenant-level overrides for the built-in post-house roles. */
export const organizationRolePolicies = pgTable("organization_role_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  label: text("label").notNull(),
  permissions: jsonb("permissions").$type<string[]>().notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("organization_role_policies_org_role_idx").on(table.organizationId, table.role),
  index("organization_role_policies_organization_id_idx").on(table.organizationId),
]);

export const shows = pgTable("shows", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  code: text("code").notNull(),
  network: text("network"),
  productionCompany: text("production_company"),
  description: text("description"),
  /** IANA zone used for facility bookings and delivery deadlines. */
  timeZone: text("time_zone").default("Europe/London").notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("shows_organization_code_idx").on(table.organizationId, table.code),
  index("shows_organization_id_idx").on(table.organizationId),
]);

export const seasons = pgTable("seasons", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  showId: uuid("show_id").notNull().references(() => shows.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title"),
  startDate: date("start_date"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("seasons_show_number_idx").on(table.showId, table.number),
  index("seasons_organization_id_idx").on(table.organizationId),
]);

export const postWorkflows = pgTable("post_workflows", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false).notNull(),
  ...auditColumns,
}, (table) => [index("post_workflows_organization_id_idx").on(table.organizationId)]);

export const workflowStages = pgTable("workflow_stages", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => postWorkflows.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key: text("key").notNull(),
  position: integer("position").notNull(),
  color: text("color").default("#687a78").notNull(),
  isTerminal: boolean("is_terminal").default(false).notNull(),
  /** Explicit exception to normal sequential progression; hard dependencies still apply. */
  canStartEarly: boolean("can_start_early").default(false).notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("workflow_stages_workflow_key_idx").on(table.workflowId, table.key),
  uniqueIndex("workflow_stages_workflow_position_idx").on(table.workflowId, table.position),
  index("workflow_stages_organization_id_idx").on(table.organizationId),
]);

export const workflowStageApprovalRules = pgTable("workflow_stage_approval_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowStageId: uuid("workflow_stage_id").notNull().references(() => workflowStages.id, { onDelete: "cascade" }),
  approverRole: text("approver_role").notNull(),
  label: text("label").notNull(),
  approvalOrder: integer("approval_order").default(1).notNull(),
  isRequired: boolean("is_required").default(true).notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("workflow_stage_approval_rules_stage_role_order_idx").on(table.workflowStageId, table.approverRole, table.approvalOrder),
  index("workflow_stage_approval_rules_stage_idx").on(table.workflowStageId),
  index("workflow_stage_approval_rules_organization_id_idx").on(table.organizationId),
]);

export const people = pgTable("people", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email"),
  role: personRole("role").notNull(),
  company: text("company"),
  isActive: boolean("is_active").default(true).notNull(),
  availability: availabilityStatus("availability").default("available").notNull(),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }),
  dayRate: numeric("day_rate", { precision: 10, scale: 2 }),
  ...auditColumns,
}, (table) => [
  index("people_organization_id_idx").on(table.organizationId),
  uniqueIndex("people_organization_user_idx").on(table.organizationId, table.userId),
]);

/** The standing post team assigned to a show; episode assignments remain separate. */
export const showTeamAssignments = pgTable("show_team_assignments", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  showId: uuid("show_id").notNull().references(() => shows.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  ...auditColumns,
}, (table) => [
  primaryKey({ columns: [table.showId, table.personId] }),
  index("show_team_assignments_person_idx").on(table.personId),
  index("show_team_assignments_organization_id_idx").on(table.organizationId),
]);

export const rooms = pgTable("rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  location: text("location"),
  capacity: integer("capacity"),
  notes: text("notes"),
  ...auditColumns,
}, (table) => [uniqueIndex("rooms_organization_name_idx").on(table.organizationId, table.name)]);

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  workflowStageId: uuid("workflow_stage_id").references(() => workflowStages.id, { onDelete: "set null" }),
  assignedProducerId: uuid("assigned_producer_id").references(() => people.id, { onDelete: "set null" }),
  editorId: uuid("editor_id").references(() => people.id, { onDelete: "set null" }),
  coloristId: uuid("colorist_id").references(() => people.id, { onDelete: "set null" }),
  soundMixerId: uuid("sound_mixer_id").references(() => people.id, { onDelete: "set null" }),
  number: integer("number").notNull(),
  productionCode: text("production_code"),
  title: text("title").notNull(),
  synopsis: text("synopsis"),
  status: episodeStatus("status").default("development").notNull(),
  qcStatus: qcStatus("qc_status").default("not_started").notNull(),
  airDate: date("air_date"),
  lockedCutDate: date("locked_cut_date"),
  deliveryDeadline: timestamp("delivery_deadline", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("episodes_season_number_idx").on(table.seasonId, table.number),
  index("episodes_workflow_stage_id_idx").on(table.workflowStageId),
  index("episodes_organization_id_idx").on(table.organizationId),
]);

export const episodeWorkflowApprovals = pgTable("episode_workflow_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  workflowStageId: uuid("workflow_stage_id").notNull().references(() => workflowStages.id, { onDelete: "cascade" }),
  approvalRuleId: uuid("approval_rule_id").notNull().references(() => workflowStageApprovalRules.id, { onDelete: "cascade" }),
  approverRole: text("approver_role").notNull(),
  requiredPersonId: uuid("required_person_id").references(() => people.id, { onDelete: "set null" }),
  approverPersonId: uuid("approver_person_id").references(() => people.id, { onDelete: "set null" }),
  status: approvalStatus("status").default("pending").notNull(),
  comment: text("comment"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("episode_workflow_approvals_episode_rule_idx").on(table.episodeId, table.approvalRuleId),
  index("episode_workflow_approvals_episode_stage_idx").on(table.episodeId, table.workflowStageId),
  index("episode_workflow_approvals_organization_id_idx").on(table.organizationId),
]);

/** Finishing stages are parallel after picture lock; they cannot be represented by one episode field. */
export const episodeWorkflowTracks = pgTable("episode_workflow_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  workflowStageId: uuid("workflow_stage_id").notNull().references(() => workflowStages.id, { onDelete: "cascade" }),
  status: workflowTrackStatus("status").default("not_started").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  blockedReason: text("blocked_reason"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("episode_workflow_tracks_episode_stage_idx").on(table.episodeId, table.workflowStageId),
  index("episode_workflow_tracks_stage_status_idx").on(table.workflowStageId, table.status),
  index("episode_workflow_tracks_organization_id_idx").on(table.organizationId),
]);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: bookingStatus("status").default("tentative").notNull(),
  bookingType: bookingType("booking_type").default("edit").notNull(),
  notes: text("notes"),
  ...auditColumns,
}, (table) => [
  index("bookings_room_time_idx").on(table.roomId, table.startsAt),
  index("bookings_episode_time_idx").on(table.episodeId, table.startsAt),
]);

/** Internal room-service requests. No payment, vendor, or dietary profile is stored. */
export const cateringRequests = pgTable("catering_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  requestedByPersonId: uuid("requested_by_person_id").references(() => people.id, { onDelete: "set null" }),
  fulfilledByPersonId: uuid("fulfilled_by_person_id").references(() => people.id, { onDelete: "set null" }),
  requestType: cateringRequestType("request_type").notNull(),
  item: text("item").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  notes: text("notes"),
  requestedFor: timestamp("requested_for", { withTimezone: true }),
  status: cateringRequestStatus("status").default("requested").notNull(),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  index("catering_requests_organization_status_idx").on(table.organizationId, table.status),
  index("catering_requests_booking_idx").on(table.bookingId),
]);

export const qcReports = pgTable("qc_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  status: qcReportStatus("status").default("draft").notNull(),
  reportUrl: text("report_url"),
  checksum: text("checksum"),
  summary: text("summary"),
  waiverReason: text("waiver_reason"),
  waivedByPersonId: uuid("waived_by_person_id").references(() => people.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [index("qc_reports_episode_status_idx").on(table.episodeId, table.status)]);

export const qcIssues = pgTable("qc_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  qcReportId: uuid("qc_report_id").notNull().references(() => qcReports.id, { onDelete: "cascade" }),
  code: text("code"),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  timecodeSeconds: numeric("timecode_seconds", { precision: 12, scale: 3 }),
  status: qcIssueStatus("status").default("open").notNull(),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  index("qc_issues_report_status_idx").on(table.qcReportId, table.status),
  index("qc_issues_organization_id_idx").on(table.organizationId),
]);

export const budgetLines = pgTable("budget_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
  code: text("code"),
  category: text("category").notNull(),
  description: text("description"),
  budgetedAmount: numeric("budgeted_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  actualAmount: numeric("actual_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  currency: text("currency").default("USD").notNull(),
  costType: costType("cost_type").default("internal").notNull(),
  ...auditColumns,
}, (table) => [index("budget_lines_organization_id_idx").on(table.organizationId)]);

/** Tenant-owned finance rate card used as the standard price list for post services. */
export const serviceRates = pgTable("service_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").default("USD").notNull(),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("service_rates_organization_name_idx").on(table.organizationId, table.name),
  index("service_rates_organization_id_idx").on(table.organizationId),
]);

export const billables = pgTable("billables", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
  vendor: text("vendor").notNull(),
  reference: text("reference"),
  description: text("description"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").default("USD").notNull(),
  status: billableStatus("status").default("draft").notNull(),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  ...auditColumns,
}, (table) => [index("billables_organization_status_idx").on(table.organizationId, table.status)]);

export const activityLog = pgTable("activity_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("activity_log_organization_created_idx").on(table.organizationId, table.createdAt),
  index("activity_log_entity_idx").on(table.entityType, table.entityId),
]);
