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
export const bookingStatus = pgEnum("booking_status", ["tentative", "confirmed", "hold", "cancelled"]);
export const bookingType = pgEnum("booking_type", ["edit", "color", "mix", "qc", "client_review", "ingest", "conform", "leave", "training", "sick", "unavailable"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "changes_requested"]);
export const billableStatus = pgEnum("billable_status", ["draft", "approved", "invoiced", "paid", "void"]);
export const clientInvoiceStatus = pgEnum("client_invoice_status", ["issued", "paid", "void"]);
export const costType = pgEnum("cost_type", ["billable", "internal"]);
export const availabilityStatus = pgEnum("availability_status", ["available", "limited", "booked_out", "away"]);
export const workflowTrackStatus = pgEnum("workflow_track_status", ["not_started", "in_progress", "submitted", "approved", "changes_requested", "blocked"]);
export const qcReportStatus = pgEnum("qc_report_status", ["draft", "in_progress", "passed", "failed", "waived"]);
export const qcIssueStatus = pgEnum("qc_issue_status", ["open", "resolved", "waived"]);
export const workOrderStatus = pgEnum("work_order_status", ["open", "awaiting_approval", "in_progress", "ready_for_review", "complete", "rejected", "cancelled"]);
export const workOrderPriority = pgEnum("work_order_priority", ["blocker", "high", "normal", "low"]);
export const workOrderKind = pgEnum("work_order_kind", ["work_order", "qc_exception"]);
export const workOrderItemType = pgEnum("work_order_item_type", ["service", "material", "expense"]);
export const workOrderWorkType = pgEnum("work_order_work_type", ["internal", "external_vendor"]);
export const workOrderBillingScope = pgEnum("work_order_billing_scope", ["included", "billable_change", "internal"]);
export const workOrderBillingStatus = pgEnum("work_order_billing_status", ["not_billable", "draft", "posted", "declined"]);
export const cateringRequestType = pgEnum("catering_request_type", ["lunch", "tea_coffee", "snack"]);
export const cateringRequestStatus = pgEnum("catering_request_status", ["requested", "acknowledged", "preparing", "delivered", "cancelled"]);
export const vendorInvoiceStatus = pgEnum("vendor_invoice_status", ["received", "approved", "paid", "disputed", "void"]);
export const purchaseOrderStatus = pgEnum("purchase_order_status", ["draft", "approved", "closed", "cancelled"]);
export const purchaseOrderAllocationType = pgEnum("purchase_order_allocation_type", ["work_order", "budget_line", "vendor_invoice"]);
export const clientPurchaseOrderStatus = pgEnum("client_purchase_order_status", ["draft", "active", "closed", "cancelled"]);
export const clientPurchaseOrderAllocationType = pgEnum("client_purchase_order_allocation_type", ["billable", "client_invoice", "change_order"]);

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
  /** All commercial records in a post house use this reporting currency. */
  currency: text("currency").default("GBP").notNull(),
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

export const crmCompanyType = pgEnum("crm_company_type", ["client", "vendor", "network", "studio", "production_company"]);
export const crmAccountStatus = pgEnum("crm_account_status", ["active", "on_hold", "inactive"]);
export const crmBookingClearance = pgEnum("crm_booking_clearance", ["clear", "authorisation_required", "finance_approval", "on_hold"]);
export const crmCompanies = pgTable("crm_companies", { id: uuid("id").defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), name: text("name").notNull(), type: crmCompanyType("type").notNull(), address: text("address"), serviceCategory: text("service_category"), isPreferredSupplier: boolean("is_preferred_supplier").default(false).notNull(), paymentTermsDays: integer("payment_terms_days"), currency: text("currency").default("GBP").notNull(), financeEmail: text("finance_email"), billingEmail: text("billing_email"), accountStatus: crmAccountStatus("account_status").default("active").notNull(), /** Operational state visible to schedulers; it deliberately contains no financial amount. */ bookingClearance: crmBookingClearance("booking_clearance").default("clear").notNull(), /** The internal person responsible for the commercial relationship. */ accountOwnerId: uuid("account_owner_id").references(() => people.id, { onDelete: "set null" }), /** A lightweight, internal follow-up—this is not a sales pipeline. */ nextAction: text("next_action"), nextActionDueAt: date("next_action_due_at"), /** Internal-only account notes; never exposed to client users. */ notes: text("notes"), ...auditColumns }, (table) => [uniqueIndex("crm_companies_org_name_idx").on(table.organizationId, table.name), index("crm_companies_org_type_idx").on(table.organizationId, table.type), index("crm_companies_org_status_idx").on(table.organizationId, table.accountStatus), index("crm_companies_org_service_idx").on(table.organizationId, table.serviceCategory), index("crm_companies_org_owner_idx").on(table.organizationId, table.accountOwnerId), index("crm_companies_org_next_action_idx").on(table.organizationId, table.nextActionDueAt), index("crm_companies_org_booking_clearance_idx").on(table.organizationId, table.bookingClearance)]);
export const crmContactType = pgEnum("crm_contact_type", ["general", "creative_approval", "technical_delivery", "finance", "legal", "client_review"]);
export const crmContacts = pgTable("crm_contacts", { id: uuid("id").defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), companyId: uuid("company_id").notNull().references(() => crmCompanies.id, { onDelete: "cascade" }), name: text("name").notNull(), title: text("title"), email: text("email"), phone: text("phone"), contactType: crmContactType("contact_type").default("general").notNull(), isPrimary: boolean("is_primary").default(false).notNull(), notes: text("notes"), ...auditColumns }, (table) => [index("crm_contacts_company_idx").on(table.companyId), index("crm_contacts_org_idx").on(table.organizationId), index("crm_contacts_org_type_idx").on(table.organizationId, table.contactType)]);

export const cateringSettings = pgTable("catering_settings", { id: uuid("id").defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), markupPercent: numeric("markup_percent", { precision: 7, scale: 2 }).default("0").notNull(), ...auditColumns }, (table) => [uniqueIndex("catering_settings_org_idx").on(table.organizationId)]);

/**
 * A tenant's statutory billing profile. Issued invoices copy these values so
 * a later settings change can never alter an already issued document.
 */
export const invoiceSettings = pgTable("invoice_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  legalName: text("legal_name"),
  legalAddress: text("legal_address"),
  billingEmail: text("billing_email"),
  taxEnabled: boolean("tax_enabled").default(false).notNull(),
  taxName: text("tax_name").default("VAT").notNull(),
  taxRegistrationNumber: text("tax_registration_number"),
  taxRatePercent: numeric("tax_rate_percent", { precision: 7, scale: 3 }).default("0").notNull(),
  paymentTermsDays: integer("payment_terms_days").default(30).notNull(),
  paymentInstructions: text("payment_instructions"),
  ...auditColumns,
}, (table) => [uniqueIndex("invoice_settings_org_idx").on(table.organizationId)]);

export const shows = pgTable("shows", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  code: text("code").notNull(),
  network: text("network"),
  productionCompany: text("production_company"),
  clientCompanyId: uuid("client_company_id").references(() => crmCompanies.id, { onDelete: "set null" }),
  productionCompanyId: uuid("production_company_id").references(() => crmCompanies.id, { onDelete: "set null" }),
  description: text("description"),
  /** IANA zone used for facility bookings and delivery deadlines. */
  timeZone: text("time_zone").default("Europe/London").notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("shows_organization_code_idx").on(table.organizationId, table.code),
  index("shows_organization_id_idx").on(table.organizationId),
]);

export const showContactResponsibility = pgEnum("show_contact_responsibility", ["creative_approvals", "delivery_qc", "finance_billing", "legal_compliance"]);
export const showContacts = pgTable("show_contacts", { id: uuid("id").defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), showId: uuid("show_id").notNull().references(() => shows.id, { onDelete: "cascade" }), contactId: uuid("contact_id").notNull().references(() => crmContacts.id, { onDelete: "cascade" }), responsibility: showContactResponsibility("responsibility").default("creative_approvals").notNull(), relationship: text("relationship").notNull(), isApprovalContact: boolean("is_approval_contact").default(false).notNull(), ...auditColumns }, (table) => [uniqueIndex("show_contacts_show_contact_idx").on(table.showId, table.contactId), uniqueIndex("show_contacts_show_responsibility_idx").on(table.showId, table.responsibility), index("show_contacts_org_idx").on(table.organizationId)]);

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
  /** A passing or authorised-waived QC report is required before this stage can progress. */
  requiresQcPass: boolean("requires_qc_pass").default(false).notNull(),
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

/** Tenant-configured checklist defaults which create episode work orders when a stage becomes active. */
export const workflowStageWorkOrderTemplates = pgTable("workflow_stage_work_order_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowStageId: uuid("workflow_stage_id").notNull().references(() => workflowStages.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  department: text("department"),
  assigneeRole: text("assignee_role"),
  priority: workOrderPriority("priority").default("normal").notNull(),
  isBlocking: boolean("is_blocking").default(true).notNull(),
  position: integer("position").default(1).notNull(),
  ...auditColumns,
}, (table) => [
  uniqueIndex("workflow_stage_work_order_templates_stage_position_idx").on(table.workflowStageId, table.position),
  index("workflow_stage_work_order_templates_organization_idx").on(table.organizationId),
]);

export const people = pgTable("people", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email"),
  /** Tenant-defined role key. Permissions and labels live in organization_role_policies. */
  role: text("role").notNull(),
  company: text("company"),
  isActive: boolean("is_active").default(true).notNull(),
  /** Marks external talent so schedulers can distinguish freelance availability. */
  isFreelancer: boolean("is_freelancer").default(false).notNull(),
  availability: availabilityStatus("availability").default("available").notNull(),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }),
  dayRate: numeric("day_rate", { precision: 10, scale: 2 }),
  ...auditColumns,
}, (table) => [
  index("people_organization_id_idx").on(table.organizationId),
  uniqueIndex("people_organization_user_idx").on(table.organizationId, table.userId),
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

export const episodeTeamAssignments = pgTable("episode_team_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  isLead: boolean("is_lead").default(false).notNull(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("episode_team_assignment_episode_person_idx").on(table.episodeId, table.personId),
  index("episode_team_assignment_episode_idx").on(table.episodeId),
  index("episode_team_assignment_org_person_idx").on(table.organizationId, table.personId),
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
  /** External guest account attending this episode-linked booking. */
  guestPersonId: uuid("guest_person_id").references(() => people.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** Operational buffers sit outside the client-facing booked window and still block resources. */
  setupMinutes: integer("setup_minutes").default(0).notNull(),
  handoverMinutes: integer("handover_minutes").default(0).notNull(),
  actualStartsAt: timestamp("actual_starts_at", { withTimezone: true }),
  actualEndsAt: timestamp("actual_ends_at", { withTimezone: true }),
  approvedOvertimeMinutes: integer("approved_overtime_minutes").default(0).notNull(),
  status: bookingStatus("status").default("tentative").notNull(),
  bookingType: bookingType("booking_type").default("edit").notNull(),
  notes: text("notes"),
  ...auditColumns,
}, (table) => [
  index("bookings_room_time_idx").on(table.roomId, table.startsAt),
  index("bookings_episode_time_idx").on(table.episodeId, table.startsAt),
  index("bookings_guest_person_time_idx").on(table.guestPersonId, table.startsAt),
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
  actualCost: numeric("actual_cost", { precision: 12, scale: 2 }),
  billedAmount: numeric("billed_amount", { precision: 12, scale: 2 }),
  markupPercent: numeric("markup_percent", { precision: 7, scale: 2 }),
  currency: text("currency").default("GBP").notNull(),
  receiptReference: text("receipt_reference"),
  billableId: uuid("billable_id").references(() => billables.id, { onDelete: "set null" }),
  budgetLineId: uuid("budget_line_id").references(() => budgetLines.id, { onDelete: "set null" }),
  ...auditColumns,
}, (table) => [
  index("catering_requests_organization_status_idx").on(table.organizationId, table.status),
  index("catering_requests_booking_idx").on(table.bookingId),
  uniqueIndex("catering_requests_billable_idx").on(table.billableId),
  uniqueIndex("catering_requests_budget_line_idx").on(table.budgetLineId),
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

/** Episode-specific operational work. This intentionally replaces the removed generic task model. */
export const postWorkOrders = pgTable("post_work_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  workflowStageId: uuid("workflow_stage_id").references(() => workflowStages.id, { onDelete: "set null" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  workType: workOrderWorkType("work_type").default("internal").notNull(),
  vendorCompanyId: uuid("vendor_company_id").references(() => crmCompanies.id, { onDelete: "set null" }),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  clientPurchaseOrderId: uuid("client_purchase_order_id").references(() => clientPurchaseOrders.id, { onDelete: "set null" }),
  qcIssueId: uuid("qc_issue_id").references(() => qcIssues.id, { onDelete: "set null" }),
  kind: workOrderKind("kind").default("work_order").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  department: text("department"),
  assigneePersonId: uuid("assignee_person_id").references(() => people.id, { onDelete: "set null" }),
  assigneeRole: text("assignee_role"),
  priority: workOrderPriority("priority").default("normal").notNull(),
  isBlocking: boolean("is_blocking").default(true).notNull(),
  status: workOrderStatus("status").default("open").notNull(),
  billingScope: workOrderBillingScope("billing_scope").default("included").notNull(),
  billingStatus: workOrderBillingStatus("billing_status").default("not_billable").notNull(),
  /** Internal estimate for work supplied by the selected vendor. */
  estimatedAmount: numeric("estimated_amount", { precision: 14, scale: 2 }),
  /** Separately agreed client charge; never reuses the vendor estimate. */
  clientQuoteAmount: numeric("client_quote_amount", { precision: 14, scale: 2 }),
  actualAmount: numeric("actual_amount", { precision: 14, scale: 2 }),
  currency: text("currency").default("USD").notNull(),
  clientQuoteCurrency: text("client_quote_currency"),
  billingNotes: text("billing_notes"),
  externalUrl: text("external_url"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByPersonId: uuid("approved_by_person_id").references(() => people.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalNote: text("approval_note"),
  completedByPersonId: uuid("completed_by_person_id").references(() => people.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("post_work_orders_qc_issue_idx").on(table.qcIssueId),
  index("post_work_orders_org_assignee_status_idx").on(table.organizationId, table.assigneePersonId, table.status),
  index("post_work_orders_episode_status_idx").on(table.episodeId, table.status),
  index("post_work_orders_organization_stage_idx").on(table.organizationId, table.workflowStageId),
  index("post_work_orders_org_purchase_order_idx").on(table.organizationId, table.purchaseOrderId),
  index("post_work_orders_org_client_purchase_order_idx").on(table.organizationId, table.clientPurchaseOrderId),
]);

/** Cost and scope breakdown kept inside the operational work order. These do
 * not create a budget line or invoice until an authorised Budget user posts it. */
export const postWorkOrderItems = pgTable("post_work_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").notNull().references(() => postWorkOrders.id, { onDelete: "cascade" }),
  type: workOrderItemType("type").default("service").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).default("1").notNull(),
  unit: text("unit").default("unit").notNull(),
  unitRate: numeric("unit_rate", { precision: 14, scale: 2 }).default("0").notNull(),
  discountPercent: numeric("discount_percent", { precision: 7, scale: 3 }).default("0").notNull(),
  notes: text("notes"),
  position: integer("position").default(1).notNull(),
  ...auditColumns,
}, (table) => [
  index("post_work_order_items_org_work_order_idx").on(table.organizationId, table.workOrderId),
]);

export const budgetLines = pgTable("budget_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").references(() => postWorkOrders.id, { onDelete: "set null" }),
  vendorInvoiceId: uuid("vendor_invoice_id").references(() => vendorInvoices.id, { onDelete: "set null" }),
  /** External supplier spend can be reserved against one optional approved PO. */
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  externalCost: boolean("external_cost").default(false).notNull(),
  code: text("code"),
  category: text("category").notNull(),
  description: text("description"),
  budgetedAmount: numeric("budgeted_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  actualAmount: numeric("actual_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  currency: text("currency").default("USD").notNull(),
  costType: costType("cost_type").default("internal").notNull(),
  ...auditColumns,
}, (table) => [
  index("budget_lines_organization_id_idx").on(table.organizationId),
  index("budget_lines_org_purchase_order_idx").on(table.organizationId, table.purchaseOrderId),
  uniqueIndex("budget_lines_work_order_id_idx").on(table.workOrderId),
  uniqueIndex("budget_lines_vendor_invoice_id_idx").on(table.vendorInvoiceId),
]);

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

export const rateCards = pgTable("rate_cards", { id: uuid("id").defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), clientCompanyId: uuid("client_company_id").references(() => crmCompanies.id, { onDelete: "cascade" }), network: text("network"), showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }), episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }), name: text("name").notNull(), currency: text("currency").default("USD").notNull(), effectiveFrom: date("effective_from"), effectiveTo: date("effective_to"), isActive: boolean("is_active").default(true).notNull(), ...auditColumns }, (table) => [index("rate_cards_org_client_idx").on(table.organizationId, table.clientCompanyId), index("rate_cards_org_network_idx").on(table.organizationId, table.network), index("rate_cards_org_show_idx").on(table.organizationId, table.showId), index("rate_cards_org_episode_idx").on(table.organizationId, table.episodeId)]);
export const rateCardItems = pgTable("rate_card_items", { id: uuid("id").defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), rateCardId: uuid("rate_card_id").notNull().references(() => rateCards.id, { onDelete: "cascade" }), serviceRateId: uuid("service_rate_id").references(() => serviceRates.id, { onDelete: "set null" }), category: text("category").notNull(), unit: text("unit").notNull(), rate: numeric("rate", { precision: 14, scale: 2 }).notNull(), ...auditColumns }, (table) => [uniqueIndex("rate_card_items_card_category_unit_idx").on(table.rateCardId, table.category, table.unit), index("rate_card_items_org_idx").on(table.organizationId)]);

/** Client-facing invoice header. Financial identity and payment terms are snapshotted at issue time. */
export const clientInvoices = pgTable("client_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  clientCompanyId: uuid("client_company_id").references(() => crmCompanies.id, { onDelete: "set null" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  status: clientInvoiceStatus("status").default("issued").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date").notNull(),
  currency: text("currency").notNull(),
  subtotalAmount: numeric("subtotal_amount", { precision: 14, scale: 2 }).notNull(),
  taxEnabled: boolean("tax_enabled").default(false).notNull(),
  taxName: text("tax_name").notNull(),
  taxRatePercent: numeric("tax_rate_percent", { precision: 7, scale: 3 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  issuerName: text("issuer_name").notNull(),
  issuerAddress: text("issuer_address"),
  issuerEmail: text("issuer_email"),
  issuerTaxRegistrationNumber: text("issuer_tax_registration_number"),
  clientName: text("client_name").notNull(),
  clientAddress: text("client_address"),
  clientEmail: text("client_email"),
  paymentInstructions: text("payment_instructions"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("client_invoices_org_sequence_idx").on(table.organizationId, table.sequence),
  uniqueIndex("client_invoices_org_number_idx").on(table.organizationId, table.invoiceNumber),
  index("client_invoices_org_episode_idx").on(table.organizationId, table.episodeId),
  index("client_invoices_org_client_idx").on(table.organizationId, table.clientCompanyId),
]);

export const billables = pgTable("billables", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
  clientInvoiceId: uuid("client_invoice_id").references(() => clientInvoices.id, { onDelete: "set null" }),
  /** Optional client billing authority selected when the charge is posted. */
  clientPurchaseOrderId: uuid("client_purchase_order_id").references(() => clientPurchaseOrders.id, { onDelete: "set null" }),
  vendor: text("vendor").notNull(),
  reference: text("reference"),
  description: text("description"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").default("USD").notNull(),
  status: billableStatus("status").default("draft").notNull(),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  rateSource: text("rate_source"),
  rateSnapshot: jsonb("rate_snapshot").$type<Record<string, unknown>>(),
  overrideReason: text("override_reason"),
  ...auditColumns,
}, (table) => [index("billables_organization_status_idx").on(table.organizationId, table.status), index("billables_client_invoice_idx").on(table.clientInvoiceId), index("billables_org_client_purchase_order_idx").on(table.organizationId, table.clientPurchaseOrderId)]);

/**
 * A client's billing-authorisation envelope. This is distinct from a vendor
 * purchase order: it controls what the facility may bill, not what it may spend.
 */
export const clientPurchaseOrders = pgTable("client_purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientCompanyId: uuid("client_company_id").notNull().references(() => crmCompanies.id, { onDelete: "restrict" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  poNumber: text("po_number").notNull(),
  currency: text("currency").notNull(),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }).notNull(),
  issueDate: date("issue_date"),
  expiryDate: date("expiry_date"),
  status: clientPurchaseOrderStatus("status").default("draft").notNull(),
  notes: text("notes"),
  externalDocumentUrl: text("external_document_url"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("client_purchase_orders_org_number_idx").on(table.organizationId, table.poNumber),
  index("client_purchase_orders_org_client_status_idx").on(table.organizationId, table.clientCompanyId, table.status),
  index("client_purchase_orders_org_show_episode_idx").on(table.organizationId, table.showId, table.episodeId),
  index("client_purchase_orders_org_expiry_idx").on(table.organizationId, table.expiryDate),
]);

/**
 * Client-side authorisation ledger. Change-order references are intentionally
 * text-only until a dedicated change-order module is introduced.
 */
export const clientPurchaseOrderAllocations = pgTable("client_purchase_order_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientPurchaseOrderId: uuid("client_purchase_order_id").notNull().references(() => clientPurchaseOrders.id, { onDelete: "cascade" }),
  allocationType: clientPurchaseOrderAllocationType("allocation_type").notNull(),
  billableId: uuid("billable_id").references(() => billables.id, { onDelete: "cascade" }),
  clientInvoiceId: uuid("client_invoice_id").references(() => clientInvoices.id, { onDelete: "cascade" }),
  clientInvoiceItemId: uuid("client_invoice_item_id").references(() => clientInvoiceItems.id, { onDelete: "cascade" }),
  changeOrderReference: text("change_order_reference"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  /** True only when a budget approver authorised the allocation beyond the client PO value. */
  overrunAuthorised: boolean("overrun_authorised").default(false).notNull(),
  allocationDate: date("allocation_date").notNull(),
  reference: text("reference"),
  description: text("description"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...auditColumns,
}, (table) => [
  index("client_po_allocations_org_po_date_idx").on(table.organizationId, table.clientPurchaseOrderId, table.allocationDate),
  uniqueIndex("client_po_allocations_po_billable_idx").on(table.clientPurchaseOrderId, table.billableId),
  uniqueIndex("client_po_allocations_po_invoice_idx").on(table.clientPurchaseOrderId, table.clientInvoiceId),
  uniqueIndex("client_po_allocations_po_invoice_item_idx").on(table.clientPurchaseOrderId, table.clientInvoiceItemId),
  uniqueIndex("client_po_allocations_po_change_order_idx").on(table.clientPurchaseOrderId, table.changeOrderReference),
  // A source may be allocated to only one client PO in a tenant. This keeps
  // the live authorisation ledger from double-counting the same billing item.
  uniqueIndex("client_po_allocations_org_billable_idx").on(table.organizationId, table.billableId),
  uniqueIndex("client_po_allocations_org_invoice_idx").on(table.organizationId, table.clientInvoiceId),
  uniqueIndex("client_po_allocations_org_invoice_item_idx").on(table.organizationId, table.clientInvoiceItemId),
]);

/** Immutable issued-invoice line snapshots, linked back to their originating client charges where possible. */
export const clientInvoiceItems = pgTable("client_invoice_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientInvoiceId: uuid("client_invoice_id").notNull().references(() => clientInvoices.id, { onDelete: "cascade" }),
  billableId: uuid("billable_id").references(() => billables.id, { onDelete: "set null" }),
  clientPurchaseOrderId: uuid("client_purchase_order_id").references(() => clientPurchaseOrders.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  reference: text("reference"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).default("1").notNull(),
  unitAmount: numeric("unit_amount", { precision: 14, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  ...auditColumns,
}, (table) => [
  index("client_invoice_items_org_invoice_idx").on(table.organizationId, table.clientInvoiceId),
  index("client_invoice_items_org_client_purchase_order_idx").on(table.organizationId, table.clientPurchaseOrderId),
  uniqueIndex("client_invoice_items_billable_idx").on(table.billableId),
]);

/** Supplier invoice register. It is kept distinct from client billables and creates one linked internal-cost line when posted. */
export const vendorInvoices = pgTable("vendor_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vendorCompanyId: uuid("vendor_company_id").notNull().references(() => crmCompanies.id, { onDelete: "restrict" }),
  workOrderId: uuid("work_order_id").references(() => postWorkOrders.id, { onDelete: "set null" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  invoiceNumber: text("invoice_number").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").default("GBP").notNull(),
  status: vendorInvoiceStatus("status").default("received").notNull(),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  externalDocumentUrl: text("external_document_url"),
  ...auditColumns,
}, (table) => [uniqueIndex("vendor_invoices_org_number_idx").on(table.organizationId, table.vendorCompanyId, table.invoiceNumber), index("vendor_invoices_org_work_order_idx").on(table.organizationId, table.workOrderId), index("vendor_invoices_org_status_idx").on(table.organizationId, table.status)]);

/**
 * A vendor's authorised spend envelope for a show or episode. Calculated
 * committed and actual balances intentionally live in allocation queries,
 * rather than being editable columns on this record.
 */
export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  vendorCompanyId: uuid("vendor_company_id").notNull().references(() => crmCompanies.id, { onDelete: "restrict" }),
  showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
  episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  poNumber: text("po_number").notNull(),
  currency: text("currency").notNull(),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }).notNull(),
  issueDate: date("issue_date"),
  expiryDate: date("expiry_date"),
  status: purchaseOrderStatus("status").default("draft").notNull(),
  notes: text("notes"),
  externalDocumentUrl: text("external_document_url"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("purchase_orders_org_number_idx").on(table.organizationId, table.poNumber),
  index("purchase_orders_org_vendor_status_idx").on(table.organizationId, table.vendorCompanyId, table.status),
  index("purchase_orders_org_show_episode_idx").on(table.organizationId, table.showId, table.episodeId),
  index("purchase_orders_org_expiry_idx").on(table.organizationId, table.expiryDate),
]);

/**
 * An immutable-style PO ledger. Each entry is linked to exactly one operational
 * source, allowing committed and invoiced values to be calculated accurately.
 */
export const purchaseOrderAllocations = pgTable("purchase_order_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  allocationType: purchaseOrderAllocationType("allocation_type").notNull(),
  workOrderId: uuid("work_order_id").references(() => postWorkOrders.id, { onDelete: "set null" }),
  budgetLineId: uuid("budget_line_id").references(() => budgetLines.id, { onDelete: "set null" }),
  vendorInvoiceId: uuid("vendor_invoice_id").references(() => vendorInvoices.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  allocationDate: date("allocation_date").notNull(),
  reference: text("reference"),
  description: text("description"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  ...auditColumns,
}, (table) => [
  index("purchase_order_allocations_org_po_date_idx").on(table.organizationId, table.purchaseOrderId, table.allocationDate),
  uniqueIndex("purchase_order_allocations_org_budget_line_idx").on(table.organizationId, table.budgetLineId),
  uniqueIndex("purchase_order_allocations_po_work_order_idx").on(table.purchaseOrderId, table.workOrderId),
  uniqueIndex("purchase_order_allocations_po_budget_line_idx").on(table.purchaseOrderId, table.budgetLineId),
  uniqueIndex("purchase_order_allocations_po_vendor_invoice_idx").on(table.purchaseOrderId, table.vendorInvoiceId),
]);

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

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }), activityId: uuid("activity_id").references(() => activityLog.id, { onDelete: "cascade" }),
  title: text("title").notNull(), body: text("body").notNull(), readAt: timestamp("read_at", { withTimezone: true }), ...auditColumns,
}, (table) => [index("notifications_person_unread_idx").on(table.personId, table.readAt)]);
