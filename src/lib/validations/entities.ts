import { z } from "zod";

const id = z.string().uuid();
const nullableId = id.nullable().optional();
const optionalDate = z.coerce.date().optional();
const optionalTimestamp = z.coerce.date().optional();
const money = z.coerce.number().nonnegative().finite();
const metadata = z.record(z.string(), z.unknown()).default({});

const episodeStatuses = ["development", "assembly", "editor_cut", "review", "locked", "online", "delivered"] as const;
const qcStatuses = ["not_started", "in_progress", "passed", "needs_attention", "waived"] as const;
const workOrderPriorities = ["blocker", "high", "normal", "low"] as const;
const workOrderStatuses = ["open", "awaiting_approval", "in_progress", "ready_for_review", "complete", "rejected", "cancelled"] as const;
const workOrderBillingScopes = ["included", "billable_change", "internal"] as const;
const workOrderItemTypes = ["service", "material", "expense"] as const;
const workOrderItemUnits = ["hour", "day", "unit", "fixed"] as const;
const workOrderWorkTypes = ["internal", "external_vendor"] as const;
const purchaseOrderStatuses = ["draft", "approved", "closed", "cancelled"] as const;
const purchaseOrderAllocationTypes = ["work_order", "budget_line", "vendor_invoice"] as const;
const clientPurchaseOrderStatuses = ["draft", "active", "closed", "cancelled"] as const;
const clientPurchaseOrderAllocationTypes = ["billable", "client_invoice", "change_order"] as const;
const roleKey = z.string().trim().min(2).max(80).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores.");

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

export const createOrganizationUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the user's name.").max(120),
  email: z.string().email("Enter a valid work email.").max(320),
  personRole: roleKey,
  membershipRole: z.enum(["admin", "member", "guest"]).default("member"),
});
export const updateOrganizationUserSchema = createOrganizationUserSchema.pick({ personRole: true, membershipRole: true });

export const showFormSchema = z.object({
  title: z.string().trim().min(1, "Show title is required.").max(160),
  code: z.string().trim().min(2, "Show code must be at least 2 characters.").max(32).toUpperCase(),
  network: z.string().trim().max(120).nullable().optional(),
  productionCompany: z.string().trim().max(120).nullable().optional(),
  clientCompanyId: nullableId,
  productionCompanyId: nullableId,
  description: z.string().trim().max(4000).nullable().optional(),
});
export const insertShowSchema = showFormSchema.extend({ organizationId: id });
export const updateShowSchema = showFormSchema.partial();

/** Internal account-management fields. The account identity itself remains controlled at creation. */
export const updateCrmCompanySchema = z.object({
  accountStatus: z.enum(["active", "on_hold", "inactive"]),
  bookingClearance: z.enum(["clear", "authorisation_required", "finance_approval", "on_hold"]),
  accountOwnerId: nullableId,
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionDueAt: z.string().date().nullable().optional(),
  notes: z.string().trim().max(8000).nullable().optional(),
});

export const insertCrmCompanySchema = z.object({
  name: z.string().trim().min(2, "Account name is required.").max(160),
  type: z.enum(["client", "vendor", "network", "studio", "production_company"]),
  address: z.string().trim().max(1000).nullable().optional(),
  serviceCategory: z.string().trim().max(160).nullable().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  financeEmail: z.string().email().max(320).nullable().optional(),
  accountStatus: z.enum(["active", "on_hold", "inactive"]).default("active"),
  bookingClearance: z.enum(["clear", "authorisation_required", "finance_approval", "on_hold"]).default("clear"),
});

export const insertCrmContactSchema = z.object({
  companyId: id,
  name: z.string().trim().min(2, "Contact name is required.").max(120),
  title: z.string().trim().max(160).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  contactType: z.enum(["general", "creative_approval", "technical_delivery", "finance", "legal", "client_review"]),
  isPrimary: z.boolean().default(false),
  notes: z.string().trim().max(4000).nullable().optional(),
});

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
  requiresQcPass: z.boolean().default(false),
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
    requiresQcPass: z.boolean(),
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
  workOrderTemplates: z.array(z.object({
    id: id.optional(),
    workflowStageId: id,
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(4000).nullable().optional(),
    department: z.string().trim().max(120).nullable().optional(),
    assigneeRole: z.string().trim().max(80).nullable().optional(),
    priority: z.enum(workOrderPriorities),
    isBlocking: z.boolean(),
    position: z.coerce.number().int().positive(),
  })).default([]),
});

export const insertPersonSchema = z.object({
  organizationId: id,
  userId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(320).nullable().optional(),
  role: roleKey,
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
  team: z.array(id).max(100).default([]),
});
export const updateEpisodeSchema = insertEpisodeSchema.omit({ seasonId: true }).partial();
export const episodeTeamAssignmentSchema = z.object({ personId: id, isLead: z.boolean().default(false) });

const bookingTypes = ["edit", "color", "mix", "qc", "client_review", "ingest", "conform", "leave", "training", "sick", "unavailable"] as const;
const personnelAvailabilityTypes = ["leave", "training", "sick", "unavailable"] as const;
const bookingFormSchema = z.object({
  organizationId: id,
  roomId: nullableId,
  episodeId: nullableId,
  personId: nullableId,
  guestPersonId: nullableId,
  title: z.string().trim().min(1).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  setupMinutes: z.coerce.number().int().min(0).max(480).default(0),
  handoverMinutes: z.coerce.number().int().min(0).max(480).default(0),
  status: z.enum(["tentative", "confirmed", "hold", "cancelled"]).default("tentative"),
  bookingType: z.enum(bookingTypes).default("edit"),
  notes: z.string().trim().max(2000).nullable().optional(),
});
function validateBooking<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value: z.infer<T>, context) => {
    const booking = value as { startsAt?: Date; endsAt?: Date; bookingType?: string; personId?: string | null; guestPersonId?: string | null; episodeId?: string | null; roomId?: string | null };
    if (booking.startsAt && booking.endsAt && booking.endsAt <= booking.startsAt) context.addIssue({ code: z.ZodIssueCode.custom, message: "End time must be after the start time.", path: ["endsAt"] });
    if (booking.guestPersonId && !booking.episodeId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose an episode before adding a guest account.", path: ["episodeId"] });
    if (booking.bookingType && personnelAvailabilityTypes.includes(booking.bookingType as typeof personnelAvailabilityTypes[number])) {
      if (!booking.personId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the person whose availability is affected.", path: ["personId"] });
      if (booking.roomId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Leave, training, sickness, and unavailability cannot reserve a room.", path: ["roomId"] });
    }
  });
}
export const insertBookingSchema = validateBooking(bookingFormSchema);
export const bookingRequestSchema = validateBooking(bookingFormSchema.omit({ organizationId: true }));
export const updateBookingSchema = bookingFormSchema.omit({ organizationId: true }).partial();

export const createBookingGuestSchema = z.object({
  episodeId: id,
  name: z.string().trim().min(2, "Enter the guest's name.").max(120),
  email: z.string().email("Enter a valid work email.").max(320),
});

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
  actualCost: money.nullable().optional(),
  receiptReference: z.string().trim().max(120).nullable().optional(),
});

export const insertQcReportSchema = z.object({
  episodeId: id,
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

export const updateQcIssueSchema = z.object({
  status: z.enum(["open", "resolved", "waived"]),
  resolution: z.string().trim().max(4000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.status === "resolved" && !value.resolution) context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "Add a resolution before closing the issue." });
});

const workOrderItemSchema = z.object({
  type: z.enum(workOrderItemTypes),
  description: z.string().trim().min(2, "Add a line-item description.").max(240),
  quantity: z.coerce.number().positive("Quantity must be greater than zero."),
  unit: z.enum(workOrderItemUnits),
  unitRate: money,
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const createPostWorkOrderSchema = z.object({
  episodeId: id,
  workflowStageId: nullableId,
  bookingId: nullableId,
  vendorCompanyId: nullableId,
  purchaseOrderId: nullableId,
  clientPurchaseOrderId: nullableId,
  workType: z.enum(workOrderWorkTypes).default("internal"),
  kind: z.enum(["work_order", "qc_exception"]).default("work_order"),
  title: z.string().trim().min(2, "A work-order title is required.").max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  assigneePersonId: nullableId,
  assigneeRole: z.string().trim().max(80).nullable().optional(),
  priority: z.enum(workOrderPriorities).default("normal"),
  isBlocking: z.boolean().optional(),
  billingScope: z.enum(workOrderBillingScopes).default("included"),
  estimatedAmount: money.nullable().optional(),
  clientQuoteAmount: money.nullable().optional(),
  billingNotes: z.string().trim().max(2000).nullable().optional(),
  items: z.array(workOrderItemSchema).max(50).default([]),
  externalUrl: z.string().url().max(2000).nullable().optional(),
  dueAt: optionalTimestamp.nullable(),
}).transform((value) => ({ ...value, isBlocking: value.isBlocking ?? Boolean(value.workflowStageId) })).refine((value) => !value.isBlocking || Boolean(value.workflowStageId), {
  message: "A blocking work order must be linked to a workflow stage.",
  path: ["workflowStageId"],
}).superRefine((value, context) => {
  if (value.workType === "external_vendor" && !value.vendorCompanyId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["vendorCompanyId"], message: "Choose a vendor for external work." });
  if (value.workType === "internal" && (value.vendorCompanyId || value.purchaseOrderId || value.estimatedAmount !== null && value.estimatedAmount !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["workType"], message: "Internal work cannot include a vendor, PO, or vendor estimate." });
  if (value.clientPurchaseOrderId && (value.workType !== "internal" || value.billingScope !== "billable_change")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clientPurchaseOrderId"], message: "A client PO is only available for internal client-billable work." });
});

export const updatePostWorkOrderSchema = z.object({
  status: z.enum(workOrderStatuses).optional(),
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  assigneePersonId: nullableId,
  assigneeRole: z.string().trim().max(80).nullable().optional(),
  vendorCompanyId: nullableId,
  purchaseOrderId: nullableId,
  clientPurchaseOrderId: nullableId,
  workType: z.enum(workOrderWorkTypes).optional(),
  priority: z.enum(workOrderPriorities).optional(),
  isBlocking: z.boolean().optional(),
  billingScope: z.enum(workOrderBillingScopes).optional(),
  estimatedAmount: money.nullable().optional(),
  clientQuoteAmount: money.nullable().optional(),
  billingNotes: z.string().trim().max(2000).nullable().optional(),
  items: z.array(workOrderItemSchema).max(50).optional(),
  externalUrl: z.string().url().max(2000).nullable().optional(),
  dueAt: optionalTimestamp.nullable(),
  approvalNote: z.string().trim().max(2000).nullable().optional(),
  overrunReason: z.string().trim().min(8, "Explain the PO overrun.").max(2000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one change.");

export const postWorkOrderChargeSchema = z.object({
  actualAmount: money.positive("Enter the client charge total."),
  category: z.string().trim().min(2).max(120).optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  clientPurchaseOrderId: nullableId,
  clientPoOverrunReason: z.string().trim().min(8, "Explain the client PO overrun before authorising it.").max(2000).nullable().optional(),
});

export const insertBudgetLineSchema = z.object({
  organizationId: id,
  showId: nullableId,
  seasonId: nullableId,
  episodeId: nullableId,
  purchaseOrderId: nullableId,
  code: z.string().trim().max(40).nullable().optional(),
  category: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  budgetedAmount: money.default(0),
  actualAmount: money.default(0),
  costType: z.enum(["billable", "internal"]).default("internal"),
  externalCost: z.boolean().default(false),
});
// Do not derive this from the insert schema with `.partial()`: Zod defaults on
// the insert shape would otherwise be materialised on a PATCH and overwrite
// omitted values such as `externalCost`.
export const updateBudgetLineSchema = z.object({
  showId: nullableId.optional(),
  seasonId: nullableId.optional(),
  episodeId: nullableId.optional(),
  purchaseOrderId: nullableId.optional(),
  code: z.string().trim().max(40).nullable().optional(),
  category: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  budgetedAmount: money.optional(),
  actualAmount: money.optional(),
  costType: z.enum(["billable", "internal"]).optional(),
  externalCost: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one budget line change.");

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
  status: z.enum(["draft", "approved", "invoiced", "paid", "void"]).default("draft"),
  invoiceDate: optionalDate.nullable(),
  dueDate: optionalDate.nullable(),
});
export const updateBillableSchema = insertBillableSchema.omit({ organizationId: true }).partial();

export const insertVendorInvoiceSchema = z.object({
  vendorCompanyId: id,
  workOrderId: nullableId,
  episodeId: id,
  invoiceNumber: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  amount: money.positive(),
  status: z.enum(["received", "approved", "paid", "disputed", "void"]).default("received"),
  invoiceDate: optionalDate.nullable(),
  dueDate: optionalDate.nullable(),
  externalDocumentUrl: z.string().url().max(2000).nullable().optional(),
});

/** A deliberately small supplier-actual entry made from a PO detail page. */
export const createPurchaseOrderActualCostSchema = z.object({
  episodeId: nullableId,
  invoiceNumber: z.string().trim().min(1, "Enter the supplier invoice or reference number.").max(120),
  invoiceDate: z.coerce.date({ error: "Enter the supplier invoice date." }),
  amount: money.positive("Enter a positive supplier cost."),
  description: z.string().trim().min(1, "Enter a short description.").max(2000),
  externalDocumentUrl: z.string().url("Enter a valid document link.").max(2000).nullable().optional(),
});

const purchaseOrderFieldsSchema = z.object({
  vendorCompanyId: id,
  showId: nullableId,
  episodeId: nullableId,
  poNumber: z.string().trim().min(1, "PO number is required.").max(120),
  approvedAmount: money.positive("Approved amount must be greater than zero."),
  issueDate: optionalDate.nullable(),
  expiryDate: optionalDate.nullable(),
  notes: z.string().trim().max(8000).nullable().optional(),
  externalDocumentUrl: z.string().url().max(2000).nullable().optional(),
});

function validatePurchaseOrderDates(value: { issueDate?: Date | null; expiryDate?: Date | null }, context: z.RefinementCtx) {
  if (value.issueDate && value.expiryDate && value.expiryDate < value.issueDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiryDate"], message: "Expiry date cannot be before the issue date." });
  }
}

const purchaseOrderFormSchema = purchaseOrderFieldsSchema.extend({ status: z.enum(purchaseOrderStatuses).default("draft") })
  .superRefine(validatePurchaseOrderDates);

/** Client-safe PO payload. Organisation and currency are always supplied by the server. */
export const createPurchaseOrderSchema = purchaseOrderFormSchema;
export const updatePurchaseOrderSchema = purchaseOrderFieldsSchema.partial().extend({ status: z.enum(purchaseOrderStatuses).optional() })
  .superRefine(validatePurchaseOrderDates);
export const insertPurchaseOrderSchema = purchaseOrderFieldsSchema.extend({
  status: z.enum(purchaseOrderStatuses).default("draft"),
  organizationId: id,
  currency: z.string().trim().length(3).toUpperCase(),
  createdByUserId: z.string().min(1).nullable().optional(),
}).superRefine(validatePurchaseOrderDates);

const purchaseOrderAllocationFormSchema = z.object({
  allocationType: z.enum(purchaseOrderAllocationTypes),
  workOrderId: nullableId,
  budgetLineId: nullableId,
  vendorInvoiceId: nullableId,
  amount: money.positive("Allocation amount must be greater than zero."),
  allocationDate: z.coerce.date(),
  reference: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, context) => {
  const references = [value.workOrderId, value.budgetLineId, value.vendorInvoiceId].filter(Boolean);
  const sourceByType = {
    work_order: value.workOrderId,
    budget_line: value.budgetLineId,
    vendor_invoice: value.vendorInvoiceId,
  };
  if (references.length !== 1 || !sourceByType[value.allocationType]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An allocation must reference exactly one record matching its allocation type.",
      path: ["allocationType"],
    });
  }
});

/** An overrun reason is audit-only and is never persisted as an editable balance. */
export const createPurchaseOrderAllocationSchema = purchaseOrderAllocationFormSchema.extend({
  overrunReason: z.string().trim().min(8, "Explain why this PO needs to exceed its authorised value.").max(2000).nullable().optional(),
});
export const insertPurchaseOrderAllocationSchema = purchaseOrderAllocationFormSchema.extend({
  organizationId: id,
  purchaseOrderId: id,
  createdByUserId: z.string().min(1).nullable().optional(),
});

const clientPurchaseOrderFieldsSchema = z.object({
  clientCompanyId: id,
  showId: nullableId,
  episodeId: nullableId,
  poNumber: z.string().trim().min(1, "PO number is required.").max(120),
  approvedAmount: money.positive("Authorised amount must be greater than zero."),
  issueDate: optionalDate.nullable(),
  expiryDate: optionalDate.nullable(),
  notes: z.string().trim().max(8000).nullable().optional(),
  externalDocumentUrl: z.string().url().max(2000).nullable().optional(),
});

const clientPurchaseOrderFormSchema = clientPurchaseOrderFieldsSchema.extend({ status: z.enum(clientPurchaseOrderStatuses).default("draft") })
  .superRefine(validatePurchaseOrderDates);

/** Client billing authorisations. Organisation and currency are supplied by the server. */
export const createClientPurchaseOrderSchema = clientPurchaseOrderFormSchema;
export const updateClientPurchaseOrderSchema = clientPurchaseOrderFieldsSchema.partial().extend({ status: z.enum(clientPurchaseOrderStatuses).optional() })
  .superRefine(validatePurchaseOrderDates);
export const insertClientPurchaseOrderSchema = clientPurchaseOrderFieldsSchema.extend({
  status: z.enum(clientPurchaseOrderStatuses).default("draft"),
  organizationId: id,
  currency: z.string().trim().length(3).toUpperCase(),
  createdByUserId: z.string().min(1).nullable().optional(),
}).superRefine(validatePurchaseOrderDates);

const clientPurchaseOrderAllocationFormSchema = z.object({
  allocationType: z.enum(clientPurchaseOrderAllocationTypes),
  billableId: nullableId,
  clientInvoiceId: nullableId,
  clientInvoiceItemId: nullableId,
  changeOrderReference: z.string().trim().min(1).max(160).nullable().optional(),
  amount: money.positive("Allocation amount must be greater than zero."),
  allocationDate: z.coerce.date(),
  reference: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, context) => {
  const references = [value.billableId, value.clientInvoiceId, value.clientInvoiceItemId, value.changeOrderReference].filter(Boolean);
  const sourceByType = {
    billable: value.billableId,
    client_invoice: value.clientInvoiceId ?? value.clientInvoiceItemId,
    change_order: value.changeOrderReference,
  };
  if (references.length !== 1 || !sourceByType[value.allocationType]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An allocation must reference exactly one record matching its allocation type.",
      path: ["allocationType"],
    });
  }
});

export const createClientPurchaseOrderAllocationSchema = clientPurchaseOrderAllocationFormSchema.extend({
  overrunReason: z.string().trim().min(8, "Explain why this client PO needs to exceed its authorised value.").max(2000).nullable().optional(),
});
export const insertClientPurchaseOrderAllocationSchema = clientPurchaseOrderAllocationFormSchema.extend({
  organizationId: id,
  clientPurchaseOrderId: id,
  createdByUserId: z.string().min(1).nullable().optional(),
});

export const insertActivityLogSchema = z.object({
  organizationId: id,
  action: z.string().trim().min(1).max(120),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(120),
  metadata,
});

export type EpisodeInput = z.infer<typeof insertEpisodeSchema>;
export type ShowInput = z.infer<typeof insertShowSchema>;
