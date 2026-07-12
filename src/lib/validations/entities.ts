import { z } from "zod";

const id = z.string().uuid();
const nullableId = id.nullable().optional();
const optionalDate = z.coerce.date().optional();
const optionalTimestamp = z.coerce.date().optional();
const money = z.coerce.number().nonnegative().finite();
const metadata = z.record(z.string(), z.unknown()).default({});

const episodeStatuses = ["development", "assembly", "editor_cut", "review", "locked", "online", "delivered"] as const;
const qcStatuses = ["not_started", "in_progress", "passed", "needs_attention", "waived"] as const;
const personRoles = ["producer", "post_supervisor", "head_of_production", "finance", "editor", "assistant_editor", "online_editor", "colorist", "sound_mixer", "supervising_sound_editor", "rerecording_mixer", "vfx_coordinator", "vfx_supervisor", "qc", "director", "network", "network_client_executive", "network_client_representative", "client", "runner", "freelancer"] as const;

export const insertUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).nullable().optional(),
  email: z.string().email().max(320),
  image: z.string().url().nullable().optional(),
  emailVerified: optionalTimestamp.nullable(),
});
export const updateUserSchema = insertUserSchema.omit({ id: true }).partial();

export const insertOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens."),
  logoUrl: z.string().url().nullable().optional(),
});
export const updateOrganizationSchema = insertOrganizationSchema.partial();

export const insertOrganizationMemberSchema = z.object({
  organizationId: id,
  userId: z.string().min(1),
  role: z.enum(["owner", "admin", "member", "guest"]).default("member"),
});
export const updateOrganizationMemberSchema = insertOrganizationMemberSchema.pick({ role: true });

export const showFormSchema = z.object({
  title: z.string().trim().min(1, "Show title is required.").max(160),
  code: z.string().trim().min(2, "Show code must be at least 2 characters.").max(32).toUpperCase(),
  network: z.string().trim().max(120).nullable().optional(),
  productionCompany: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  teamMemberIds: z.array(id).max(100).refine((ids) => new Set(ids).size === ids.length, "Team members must be unique.").default([]),
});
export const insertShowSchema = showFormSchema.extend({ organizationId: id });
export const updateShowSchema = showFormSchema.partial();

export const insertSeasonSchema = z.object({
  showId: id,
  number: z.coerce.number().int().positive(),
  title: z.string().trim().max(160).nullable().optional(),
  startDate: optionalDate.nullable(),
});
export const updateSeasonSchema = insertSeasonSchema.omit({ showId: true }).partial();

export const insertPostWorkflowSchema = z.object({
  organizationId: id,
  showId: nullableId,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  isDefault: z.boolean().default(false),
});
export const updatePostWorkflowSchema = insertPostWorkflowSchema.omit({ organizationId: true }).partial();

export const insertWorkflowStageSchema = z.object({
  workflowId: id,
  name: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/),
  position: z.coerce.number().int().nonnegative(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#687a78"),
  isTerminal: z.boolean().default(false),
  canStartEarly: z.boolean().default(false),
});
export const updateWorkflowStageSchema = insertWorkflowStageSchema.omit({ workflowId: true }).partial();

export const updateWorkflowTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  stages: z.array(z.object({
    id: id,
    name: z.string().trim().min(2).max(80),
    key: z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/),
    position: z.coerce.number().int().positive(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    isTerminal: z.boolean(),
    canStartEarly: z.boolean(),
  })).min(1)
    .refine((stages) => new Set(stages.map((stage) => stage.key)).size === stages.length, { message: "Workflow stage keys must be unique." })
    .refine((stages) => new Set(stages.map((stage) => stage.position)).size === stages.length, { message: "Workflow stage positions must be unique." }),
  rules: z.array(z.object({
    id: id.optional(),
    workflowStageId: id,
    approverRole: z.string().trim().min(2).max(80),
    label: z.string().trim().min(2).max(120),
    approvalOrder: z.coerce.number().int().positive(),
    isRequired: z.boolean(),
  })),
});

export const insertPersonSchema = z.object({
  organizationId: id,
  userId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(320).nullable().optional(),
  role: z.enum(personRoles),
  company: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().default(true),
  availability: z.enum(["available", "limited", "booked_out", "away"]).default("available"),
  hourlyRate: z.coerce.number().nonnegative().nullable().optional(),
  dayRate: z.coerce.number().nonnegative().nullable().optional(),
});
export const updatePersonSchema = insertPersonSchema.omit({ organizationId: true }).partial();

export const insertRoomSchema = z.object({
  organizationId: id,
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(60),
  location: z.string().trim().max(120).nullable().optional(),
  capacity: z.coerce.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export const updateRoomSchema = insertRoomSchema.omit({ organizationId: true }).partial();

export const insertEpisodeSchema = z.object({
  seasonId: id,
  workflowStageId: nullableId,
  assignedProducerId: nullableId,
  editorId: nullableId,
  coloristId: nullableId,
  soundMixerId: nullableId,
  number: z.coerce.number().int().positive(),
  productionCode: z.string().trim().max(40).nullable().optional(),
  title: z.string().trim().min(1, "Episode title is required.").max(160),
  synopsis: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(episodeStatuses).default("development"),
  qcStatus: z.enum(qcStatuses).default("not_started"),
  airDate: optionalDate.nullable(),
  lockedCutDate: optionalDate.nullable(),
  deliveryDeadline: optionalTimestamp.nullable(),
});
export const updateEpisodeSchema = insertEpisodeSchema.omit({ seasonId: true }).partial();

const bookingFormSchema = z.object({
  organizationId: id,
  roomId: nullableId,
  episodeId: nullableId,
  personId: nullableId,
  title: z.string().trim().min(1).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: z.enum(["tentative", "confirmed", "hold", "cancelled"]).default("tentative"),
  bookingType: z.enum(["edit", "color", "mix", "qc", "client_review", "ingest", "conform"]).default("edit"),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export const insertBookingSchema = bookingFormSchema.refine((value) => value.endsAt > value.startsAt, { message: "End time must be after the start time.", path: ["endsAt"] });
export const bookingRequestSchema = bookingFormSchema.omit({ organizationId: true }).refine((value) => value.endsAt > value.startsAt, { message: "End time must be after the start time.", path: ["endsAt"] });
export const updateBookingSchema = bookingFormSchema.omit({ organizationId: true }).partial();

export const createCateringRequestSchema = z.object({
  bookingId: nullableId,
  roomId: nullableId,
  requestType: z.enum(["lunch", "tea_coffee", "snack"]),
  item: z.string().trim().min(2, "Describe the request.").max(240),
  quantity: z.coerce.number().int().positive().max(20).default(1),
  notes: z.string().trim().max(1000).nullable().optional(),
  requestedFor: optionalTimestamp.nullable(),
}).refine((value) => value.bookingId || value.roomId, { message: "Choose a booking or room.", path: ["roomId"] });

export const updateCateringRequestSchema = z.object({
  status: z.enum(["requested", "acknowledged", "preparing", "delivered", "cancelled"]),
  runnerNote: z.string().trim().max(1000).nullable().optional(),
});

export const insertTaskSchema = z.object({
  organizationId: id,
  showId: nullableId,
  episodeId: nullableId,
  workflowStageId: nullableId,
  assigneeId: nullableId,
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(8000).nullable().optional(),
  status: z.enum(["not_started", "in_progress", "blocked", "complete"]).default("not_started"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueAt: optionalTimestamp.nullable(),
});
export const updateTaskSchema = insertTaskSchema.omit({ organizationId: true }).partial();

export const insertReviewCutSchema = z.object({
  organizationId: id,
  episodeId: id,
  title: z.string().trim().min(1).max(240),
  version: z.coerce.number().int().positive(),
  runtimeSeconds: z.coerce.number().positive().nullable().optional(),
  status: z.enum(["draft", "in_review", "approved", "changes_requested", "superseded"]).default("draft"),
  approvalStatus: z.enum(["pending", "approved", "changes_requested"]).default("pending"),
  submittedAt: optionalTimestamp.nullable(),
  dueAt: optionalTimestamp.nullable(),
});
export const updateReviewCutSchema = insertReviewCutSchema.omit({ organizationId: true, episodeId: true }).partial();
export const reviewCutRequestSchema = insertReviewCutSchema.omit({ organizationId: true });

export const insertReviewNoteSchema = z.object({
  reviewCutId: id,
  authorName: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().min(1).max(80).default("Editorial"),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  body: z.string().trim().min(1).max(8000),
  timecodeSeconds: z.coerce.number().nonnegative().nullable().optional(),
  status: z.enum(["open", "addressed", "wont_fix"]).default("open"),
});
export const updateReviewNoteSchema = insertReviewNoteSchema.omit({ reviewCutId: true }).partial();

export const insertDeliverableSchema = z.object({
  organizationId: id,
  episodeId: id,
  name: z.string().trim().min(1).max(240),
  destination: z.string().trim().min(1).max(240),
  status: z.enum(["not_started", "in_progress", "qc", "ready", "ready_for_qc", "failed_qc", "approved", "delivered", "rejected"]).default("not_started"),
  dueAt: optionalTimestamp.nullable(),
});
export const updateDeliverableSchema = insertDeliverableSchema.omit({ organizationId: true, episodeId: true }).partial();

export const insertDeliveryRequirementSchema = z.object({
  deliverableId: id,
  label: z.string().trim().min(1).max(240),
  specification: z.string().trim().max(4000).nullable().optional(),
  isRequired: z.boolean().default(true),
  isComplete: z.boolean().default(false),
});
export const updateDeliveryRequirementSchema = insertDeliveryRequirementSchema.omit({ deliverableId: true }).partial();

export const updateDeliveryRequirementProgressSchema = z.object({
  isComplete: z.boolean(),
  evidenceUrl: z.string().url().max(2000).nullable().optional(),
  checksum: z.string().trim().min(8).max(255).nullable().optional(),
  deliverableStatus: z.enum(["not_started", "in_progress", "qc", "ready", "ready_for_qc", "failed_qc", "approved", "delivered", "rejected"]).optional(),
});

export const insertQcReportSchema = z.object({
  episodeId: id,
  deliverableId: nullableId,
  reviewCutId: nullableId,
  status: z.enum(["draft", "in_progress", "passed", "failed", "waived"]),
  reportUrl: z.string().url().max(2000).nullable().optional(),
  checksum: z.string().trim().min(8).max(255).nullable().optional(),
  summary: z.string().trim().max(8000).nullable().optional(),
  waiverReason: z.string().trim().min(8).max(4000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.status === "waived" && !value.waiverReason) context.addIssue({ code: z.ZodIssueCode.custom, path: ["waiverReason"], message: "A waiver reason is required." });
});

export const insertQcIssueSchema = z.object({
  qcReportId: id,
  code: z.string().trim().max(80).nullable().optional(),
  severity: z.enum(["minor", "major", "critical"]),
  description: z.string().trim().min(1).max(4000),
  timecodeSeconds: z.coerce.number().nonnegative().nullable().optional(),
});

export const reviewCutApprovalRequestSchema = z.object({
  action: z.enum(["approve", "request_changes"]),
  comment: z.string().trim().max(4000).optional(),
});

export const insertBudgetLineSchema = z.object({
  organizationId: id,
  showId: nullableId,
  seasonId: nullableId,
  episodeId: nullableId,
  code: z.string().trim().max(40).nullable().optional(),
  category: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  budgetedAmount: money.default(0),
  actualAmount: money.default(0),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  costType: z.enum(["billable", "internal"]).default("internal"),
});
export const updateBudgetLineSchema = insertBudgetLineSchema.omit({ organizationId: true }).partial();

// Costs are tracked at episode level. The broader insert schema remains useful for
// importing historical data, while the product-facing create route uses this one.
export const createEpisodeBudgetLineSchema = insertBudgetLineSchema.omit({ organizationId: true }).extend({
  episodeId: id,
});

export const insertServiceRateSchema = z.object({
  organizationId: id,
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(120),
  unit: z.enum(["hour", "day", "episode", "fixed"]),
  rate: money.positive(),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
});
export const updateServiceRateSchema = insertServiceRateSchema.omit({ organizationId: true }).partial();

export const updateOrganizationRolePoliciesSchema = z.object({
  policies: z.array(z.object({
    role: z.string().trim().min(2).max(80),
    label: z.string().trim().min(2).max(120),
    permissions: z.array(z.string()),
  })).min(1),
});

export const insertBillableSchema = z.object({
  organizationId: id,
  showId: nullableId,
  episodeId: nullableId,
  vendor: z.string().trim().min(1).max(160),
  reference: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  amount: money,
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  status: z.enum(["draft", "approved", "invoiced", "paid", "void"]).default("draft"),
  invoiceDate: optionalDate.nullable(),
  dueDate: optionalDate.nullable(),
});
export const updateBillableSchema = insertBillableSchema.omit({ organizationId: true }).partial();

export const insertActivityLogSchema = z.object({
  organizationId: id,
  action: z.string().trim().min(1).max(120),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(120),
  metadata,
});

export type EpisodeInput = z.infer<typeof insertEpisodeSchema>;
export type ShowInput = z.infer<typeof insertShowSchema>;
export type TaskInput = z.infer<typeof insertTaskSchema>;
