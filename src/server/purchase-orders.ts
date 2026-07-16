import "server-only";

import { and, eq } from "drizzle-orm";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { budgetLines, crmCompanies, episodes, postWorkOrders, purchaseOrderAllocations, purchaseOrders, seasons, shows, vendorInvoices } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { createPurchaseOrderActualCostSchema, createPurchaseOrderAllocationSchema, createPurchaseOrderSchema, updatePurchaseOrderSchema } from "@/lib/validations/entities";
import { getPurchaseOrderDetailForOrganization } from "@/server/data/purchase-orders";

export class PurchaseOrderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type ActivePoContext = { organizationId: string; currency: string; userId: string };
type PurchaseOrderScope = { vendorCompanyId: string; showId: string | null; episodeId: string | null };
type BudgetLinePurchaseOrderScope = { purchaseOrderId: string | null | undefined; externalCost: boolean; showId: string; episodeId: string };
export type WorkOrderPurchaseOrderCommitment = {
  purchaseOrderId: string;
  workOrderId: string;
  allocationId: string | null;
  amount: string;
  allocationDate: string;
  reference: string;
  description: string;
  overrunAmount: number;
  overrunReason: string | null;
};

const calculatedFieldNames = new Set(["authorisedAmount", "committedAmount", "actualInvoicedAmount", "remainingAmount", "remainingBalance", "varianceAmount"]);
const toDate = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;

function rejectCalculatedPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  if (Object.keys(payload).some((key) => calculatedFieldNames.has(key))) {
    throw new PurchaseOrderError(400, "PO balances are calculated from allocations and cannot be edited.");
  }
}

async function requireActiveContext(): Promise<ActivePoContext> {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) throw new PurchaseOrderError(401, "No active post house.");
  return { organizationId: context.organization.organizationId, currency: context.organization.currency, userId: context.userId };
}

async function requireBudgetManager() {
  const context = await requireActiveContext();
  if (!(await can("manage_budget"))) throw new PurchaseOrderError(403, "Your role needs the Budget permission.");
  return context;
}

async function requireBudgetApprover() {
  const context = await requireActiveContext();
  if (!(await can("approve_budget_overruns"))) throw new PurchaseOrderError(403, "Your role needs the Budget approval permission.");
  return context;
}

async function resolvePurchaseOrderScope(organizationId: string, scope: PurchaseOrderScope) {
  const db = getDb();
  const [[vendor], [show], [episode]] = await Promise.all([
    db.select({ id: crmCompanies.id, type: crmCompanies.type }).from(crmCompanies)
      .where(and(eq(crmCompanies.id, scope.vendorCompanyId), eq(crmCompanies.organizationId, organizationId))).limit(1),
    scope.showId ? db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, scope.showId), eq(shows.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    scope.episodeId ? db.select({ id: episodes.id, showId: shows.id }).from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(episodes.id, scope.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1) : Promise.resolve([]),
  ]);
  if (!vendor) throw new PurchaseOrderError(404, "Vendor not found in this post house.");
  if (vendor.type !== "vendor") throw new PurchaseOrderError(400, "The selected company is not a vendor account.");
  if (scope.showId && !show) throw new PurchaseOrderError(404, "Show not found in this post house.");
  if (scope.episodeId && !episode) throw new PurchaseOrderError(404, "Episode not found in this post house.");
  if (scope.showId && episode && scope.showId !== episode.showId) throw new PurchaseOrderError(400, "The selected episode does not belong to the selected show.");
  return { showId: episode?.showId ?? scope.showId, episodeId: scope.episodeId };
}

/**
 * A direct budget line may reserve a PO only when it represents external
 * supplier spend. The PO is resolved from the active tenant and must cover
 * the line's show/episode scope; browser-supplied IDs are never trusted.
 */
export async function resolveBudgetLinePurchaseOrder(organizationId: string, input: BudgetLinePurchaseOrderScope) {
  if (!input.purchaseOrderId) return null;
  if (!input.externalCost) throw new PurchaseOrderError(400, "Only external-cost budget lines can be linked to a purchase order.");
  const [order] = await getDb().select({
    id: purchaseOrders.id,
    showId: purchaseOrders.showId,
    episodeId: purchaseOrders.episodeId,
    status: purchaseOrders.status,
  }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, input.purchaseOrderId), eq(purchaseOrders.organizationId, organizationId))).limit(1);
  if (!order) throw new PurchaseOrderError(404, "Purchase order not found in this post house.");
  if (order.status !== "approved") throw new PurchaseOrderError(409, "Only an approved purchase order can receive a new commitment.");
  if (order.showId && order.showId !== input.showId) throw new PurchaseOrderError(409, "This purchase order is for a different show.");
  if (order.episodeId && order.episodeId !== input.episodeId) throw new PurchaseOrderError(409, "This purchase order is for a different episode.");
  return order;
}

export async function createActivePurchaseOrder(payload: unknown) {
  rejectCalculatedPayload(payload);
  const parsed = createPurchaseOrderSchema.safeParse(payload);
  if (!parsed.success) throw new PurchaseOrderError(400, parsed.error.issues[0]?.message ?? "Check the purchase order.");
  if (parsed.data.status !== "draft") throw new PurchaseOrderError(403, "Only a budget approver can approve, close, or cancel a PO.");
  const context = await requireBudgetManager();
  const scope = await resolvePurchaseOrderScope(context.organizationId, {
    vendorCompanyId: parsed.data.vendorCompanyId,
    showId: parsed.data.showId ?? null,
    episodeId: parsed.data.episodeId ?? null,
  });
  try {
    const [order] = await getDb().insert(purchaseOrders).values({
      organizationId: context.organizationId,
      vendorCompanyId: parsed.data.vendorCompanyId,
      showId: scope.showId,
      episodeId: scope.episodeId,
      poNumber: parsed.data.poNumber,
      currency: context.currency,
      approvedAmount: String(parsed.data.approvedAmount),
      issueDate: toDate(parsed.data.issueDate),
      expiryDate: toDate(parsed.data.expiryDate),
      status: "draft",
      notes: parsed.data.notes ?? null,
      externalDocumentUrl: parsed.data.externalDocumentUrl ?? null,
      createdByUserId: context.userId,
    }).returning({ id: purchaseOrders.id });
    await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "purchase_order.created", entityType: "purchase_order", entityId: order.id, metadata: { poNumber: parsed.data.poNumber } });
    return getPurchaseOrderDetailForOrganization(context.organizationId, order.id);
  } catch (error) {
    if (error instanceof PurchaseOrderError) throw error;
    throw new PurchaseOrderError(409, "A PO with that number already exists in this post house.");
  }
}

function validStatusTransition(current: "draft" | "approved" | "closed" | "cancelled", next: "draft" | "approved" | "closed" | "cancelled") {
  if (current === next) return true;
  return (current === "draft" && ["approved", "cancelled"].includes(next))
    || (current === "approved" && ["closed", "cancelled"].includes(next));
}

export async function updateActivePurchaseOrder(purchaseOrderId: string, payload: unknown) {
  rejectCalculatedPayload(payload);
  const parsed = updatePurchaseOrderSchema.safeParse(payload);
  if (!parsed.success || !Object.keys(parsed.data).length) throw new PurchaseOrderError(400, parsed.success ? "Provide at least one PO change." : parsed.error.issues[0]?.message ?? "Check the purchase order.");
  const context = await requireActiveContext();
  const [order] = await getDb().select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, context.organizationId))).limit(1);
  if (!order) throw new PurchaseOrderError(404, "Purchase order not found.");

  const requestedStatus = parsed.data.status;
  const hasStatusChange = requestedStatus !== undefined && requestedStatus !== order.status;
  const editableFields = { ...parsed.data };
  delete editableFields.status;
  if (hasStatusChange) {
    await requireBudgetApprover();
    if (!validStatusTransition(order.status, requestedStatus!)) throw new PurchaseOrderError(409, "That PO status transition is not allowed.");
  }
  if (Object.keys(editableFields).length) {
    if (order.status !== "draft") throw new PurchaseOrderError(409, "Only draft POs can be edited.");
    await requireBudgetManager();
  }
  if (!hasStatusChange && !Object.keys(editableFields).length) throw new PurchaseOrderError(400, "Provide a PO change.");

  const scope = Object.keys(editableFields).length ? await resolvePurchaseOrderScope(context.organizationId, {
    vendorCompanyId: editableFields.vendorCompanyId ?? order.vendorCompanyId,
    showId: editableFields.showId === undefined ? order.showId : editableFields.showId,
    episodeId: editableFields.episodeId === undefined ? order.episodeId : editableFields.episodeId,
  }) : { showId: order.showId, episodeId: order.episodeId };
  await getDb().update(purchaseOrders).set({
    ...(editableFields.vendorCompanyId === undefined ? {} : { vendorCompanyId: editableFields.vendorCompanyId }),
    ...(editableFields.poNumber === undefined ? {} : { poNumber: editableFields.poNumber }),
    ...(editableFields.approvedAmount === undefined ? {} : { approvedAmount: String(editableFields.approvedAmount) }),
    ...(editableFields.issueDate === undefined ? {} : { issueDate: toDate(editableFields.issueDate) }),
    ...(editableFields.expiryDate === undefined ? {} : { expiryDate: toDate(editableFields.expiryDate) }),
    ...(editableFields.notes === undefined ? {} : { notes: editableFields.notes }),
    ...(editableFields.externalDocumentUrl === undefined ? {} : { externalDocumentUrl: editableFields.externalDocumentUrl }),
    ...(Object.keys(editableFields).length ? { showId: scope.showId, episodeId: scope.episodeId } : {}),
    ...(hasStatusChange ? { status: requestedStatus } : {}),
    updatedAt: new Date(),
  }).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, context.organizationId)));
  const action = hasStatusChange ? `purchase_order.${requestedStatus}` : "purchase_order.updated";
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action, entityType: "purchase_order", entityId: purchaseOrderId, metadata: { poNumber: editableFields.poNumber ?? order.poNumber } });
  return getPurchaseOrderDetailForOrganization(context.organizationId, purchaseOrderId);
}

async function validateAllocationSource(organizationId: string, order: typeof purchaseOrders.$inferSelect, input: { allocationType: "work_order" | "budget_line" | "vendor_invoice"; workOrderId?: string | null; budgetLineId?: string | null; vendorInvoiceId?: string | null }, options: { allowAwaitingApproval?: boolean } = {}) {
  const db = getDb();
  let source: { vendorCompanyId: string | null; showId: string | null; episodeId: string | null; status?: string } | null = null;
  if (input.allocationType === "work_order") {
    const [workOrder] = await db.select({ vendorCompanyId: postWorkOrders.vendorCompanyId, showId: shows.id, episodeId: postWorkOrders.episodeId, status: postWorkOrders.status }).from(postWorkOrders)
      .innerJoin(episodes, eq(postWorkOrders.episodeId, episodes.id)).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(postWorkOrders.id, input.workOrderId!), eq(postWorkOrders.organizationId, organizationId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1);
    source = workOrder ?? null;
  } else if (input.allocationType === "budget_line") {
    const [budgetLine] = await db.select({ showId: budgetLines.showId, episodeId: budgetLines.episodeId, externalCost: budgetLines.externalCost }).from(budgetLines)
      .where(and(eq(budgetLines.id, input.budgetLineId!), eq(budgetLines.organizationId, organizationId))).limit(1);
    source = budgetLine ? { ...budgetLine, vendorCompanyId: null } : null;
  } else {
    const [invoice] = await db.select({ vendorCompanyId: vendorInvoices.vendorCompanyId, showId: vendorInvoices.showId, episodeId: vendorInvoices.episodeId }).from(vendorInvoices)
      .where(and(eq(vendorInvoices.id, input.vendorInvoiceId!), eq(vendorInvoices.organizationId, organizationId))).limit(1);
    source = invoice ?? null;
  }
  if (!source) throw new PurchaseOrderError(404, "Allocation source not found in this post house.");
  if (input.allocationType === "budget_line" && !(source as { externalCost?: boolean }).externalCost) throw new PurchaseOrderError(409, "Only external-cost budget lines can consume a purchase order.");
  if (input.allocationType === "work_order" && !source.status?.match(options.allowAwaitingApproval ? /^(awaiting_approval|in_progress|complete)$/ : /^(in_progress|complete)$/)) throw new PurchaseOrderError(409, "Only approved or completed work orders can consume a PO.");
  if (source.vendorCompanyId && source.vendorCompanyId !== order.vendorCompanyId) throw new PurchaseOrderError(400, "The allocation source belongs to a different vendor.");
  if (order.showId && source.showId !== order.showId) throw new PurchaseOrderError(400, "The allocation source belongs to a different show.");
  if (order.episodeId && source.episodeId !== order.episodeId) throw new PurchaseOrderError(400, "The allocation source belongs to a different episode.");
}

/**
 * Validates the live PO balance before a work-order approval changes status.
 * The caller applies the returned plan in the same transaction as the approval.
 */
export async function planWorkOrderPurchaseOrderCommitment(input: {
  organizationId: string;
  workOrderId: string;
  purchaseOrderId: string;
  estimatedAmount: string | number | null;
  overrunReason?: string | null;
}) : Promise<WorkOrderPurchaseOrderCommitment> {
  const amount = Number(input.estimatedAmount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new PurchaseOrderError(409, "Add an estimated vendor cost before approving work linked to a PO.");
  const db = getDb();
  const [[order], [existing]] = await Promise.all([
    db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, input.purchaseOrderId), eq(purchaseOrders.organizationId, input.organizationId))).limit(1),
    db.select({ id: purchaseOrderAllocations.id, amount: purchaseOrderAllocations.amount }).from(purchaseOrderAllocations)
      .where(and(eq(purchaseOrderAllocations.organizationId, input.organizationId), eq(purchaseOrderAllocations.workOrderId, input.workOrderId), eq(purchaseOrderAllocations.allocationType, "work_order"))).limit(1),
  ]);
  if (!order) throw new PurchaseOrderError(404, "Purchase order not found.");
  if (order.status !== "approved") throw new PurchaseOrderError(409, "Only approved POs can receive work-order commitments.");
  await validateAllocationSource(input.organizationId, order, { allocationType: "work_order", workOrderId: input.workOrderId }, { allowAwaitingApproval: true });
  const detail = await getPurchaseOrderDetailForOrganization(input.organizationId, order.id);
  if (!detail) throw new PurchaseOrderError(404, "Purchase order not found.");
  const nextCommitted = detail.committedAmount - Number(existing?.amount ?? 0) + amount;
  const overrunAmount = Math.max(0, nextCommitted - detail.authorisedAmount);
  if (overrunAmount > 0) {
    if (!input.overrunReason?.trim()) throw new PurchaseOrderError(400, `This approval exceeds ${order.poNumber}'s remaining value by ${new Intl.NumberFormat("en-GB", { style: "currency", currency: order.currency }).format(overrunAmount)}. Add an overrun reason.`);
    if (!(await can("approve_budget_overruns"))) throw new PurchaseOrderError(403, `Budget approval is required to authorise this ${new Intl.NumberFormat("en-GB", { style: "currency", currency: order.currency }).format(overrunAmount)} PO overrun.`);
  }
  return {
    purchaseOrderId: order.id,
    workOrderId: input.workOrderId,
    allocationId: existing?.id ?? null,
    amount: amount.toFixed(2),
    allocationDate: new Date().toISOString().slice(0, 10),
    reference: `WO-${input.workOrderId.slice(0, 8).toUpperCase()}`,
    description: "Approved external vendor work-order commitment.",
    overrunAmount,
    overrunReason: input.overrunReason?.trim() || null,
  };
}

export async function createActivePurchaseOrderAllocation(purchaseOrderId: string, payload: unknown) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && ["organizationId", "purchaseOrderId", "createdByUserId"].some((key) => key in payload)) throw new PurchaseOrderError(400, "Tenant and PO identity are resolved by the server.");
  const parsed = createPurchaseOrderAllocationSchema.safeParse(payload);
  if (!parsed.success) throw new PurchaseOrderError(400, parsed.error.issues[0]?.message ?? "Check the PO allocation.");
  const context = await requireBudgetManager();
  const [order] = await getDb().select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, context.organizationId))).limit(1);
  if (!order) throw new PurchaseOrderError(404, "Purchase order not found.");
  if (order.status !== "approved") throw new PurchaseOrderError(409, "Only approved POs can receive allocations.");
  await validateAllocationSource(context.organizationId, order, parsed.data);
  if (parsed.data.allocationType === "work_order") {
    const [existing] = await getDb().select({ id: purchaseOrderAllocations.id }).from(purchaseOrderAllocations)
      .where(and(eq(purchaseOrderAllocations.organizationId, context.organizationId), eq(purchaseOrderAllocations.workOrderId, parsed.data.workOrderId!), eq(purchaseOrderAllocations.allocationType, "work_order"))).limit(1);
    if (existing) throw new PurchaseOrderError(409, "This work order already has a PO commitment.");
  }
  if (parsed.data.allocationType === "budget_line") {
    const [existing] = await getDb().select({ id: purchaseOrderAllocations.id }).from(purchaseOrderAllocations)
      .where(and(eq(purchaseOrderAllocations.organizationId, context.organizationId), eq(purchaseOrderAllocations.budgetLineId, parsed.data.budgetLineId!), eq(purchaseOrderAllocations.allocationType, "budget_line"))).limit(1);
    if (existing) throw new PurchaseOrderError(409, "This budget line already has a PO commitment.");
  }
  const detail = await getPurchaseOrderDetailForOrganization(context.organizationId, purchaseOrderId);
  if (!detail) throw new PurchaseOrderError(404, "Purchase order not found.");
  const nextCommitted = detail.committedAmount + (parsed.data.allocationType === "vendor_invoice" ? 0 : parsed.data.amount);
  const nextActual = detail.actualInvoicedAmount + (parsed.data.allocationType === "vendor_invoice" ? parsed.data.amount : 0);
  const exceedsAuthorisedValue = Math.max(nextCommitted, nextActual) > detail.authorisedAmount;
  if (exceedsAuthorisedValue) {
    await requireBudgetApprover();
    if (!parsed.data.overrunReason) throw new PurchaseOrderError(400, "Explain the PO overrun before authorising it.");
  }
  const [allocation] = await getDb().insert(purchaseOrderAllocations).values({
    organizationId: context.organizationId,
    purchaseOrderId,
    allocationType: parsed.data.allocationType,
    workOrderId: parsed.data.workOrderId ?? null,
    budgetLineId: parsed.data.budgetLineId ?? null,
    vendorInvoiceId: parsed.data.vendorInvoiceId ?? null,
    amount: String(parsed.data.amount),
    allocationDate: toDate(parsed.data.allocationDate)!,
    reference: parsed.data.reference ?? null,
    description: parsed.data.description ?? null,
    createdByUserId: context.userId,
  }).returning({ id: purchaseOrderAllocations.id });
  if (parsed.data.allocationType === "budget_line") await getDb().update(budgetLines).set({ purchaseOrderId, updatedAt: new Date() })
    .where(and(eq(budgetLines.id, parsed.data.budgetLineId!), eq(budgetLines.organizationId, context.organizationId)));
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: exceedsAuthorisedValue ? "purchase_order.overrun_authorised" : "purchase_order.allocated", entityType: "purchase_order", entityId: purchaseOrderId, metadata: { allocationId: allocation.id, allocationType: parsed.data.allocationType, amount: parsed.data.amount, overrunReason: parsed.data.overrunReason ?? null } });
  return getPurchaseOrderDetailForOrganization(context.organizationId, purchaseOrderId);
}

/**
 * Record a supplier actual against a PO without introducing an AP or payment
 * workflow. One entry creates one vendor invoice, PO invoice allocation, and
 * external budget actual in a single tenant-scoped transaction.
 */
export async function recordActivePurchaseOrderActualCost(purchaseOrderId: string, payload: unknown) {
  const parsed = createPurchaseOrderActualCostSchema.safeParse(payload);
  if (!parsed.success) throw new PurchaseOrderError(400, parsed.error.issues[0]?.message ?? "Check the supplier actual cost.");
  const context = await requireBudgetManager();
  const db = getDb();
  const [order] = await db.select({ id: purchaseOrders.id, vendorCompanyId: purchaseOrders.vendorCompanyId, showId: purchaseOrders.showId, episodeId: purchaseOrders.episodeId, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status })
    .from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, context.organizationId))).limit(1);
  if (!order) throw new PurchaseOrderError(404, "Purchase order not found.");
  if (!["approved", "closed"].includes(order.status)) throw new PurchaseOrderError(409, "Supplier actuals can only be recorded against an approved or closed PO.");
  if (order.episodeId && parsed.data.episodeId && parsed.data.episodeId !== order.episodeId) throw new PurchaseOrderError(409, "This purchase order is restricted to a different episode.");
  const episodeId = order.episodeId ?? parsed.data.episodeId;
  if (!episodeId) throw new PurchaseOrderError(400, "Choose the episode that should receive this supplier actual cost.");
  const [episode] = await db.select({ id: episodes.id, showId: shows.id, seasonId: seasons.id }).from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
    .where(and(eq(episodes.id, episodeId), eq(episodes.organizationId, context.organizationId), eq(seasons.organizationId, context.organizationId), eq(shows.organizationId, context.organizationId))).limit(1);
  if (!episode) throw new PurchaseOrderError(404, "Episode not found in this post house.");
  if (order.showId && order.showId !== episode.showId) throw new PurchaseOrderError(409, "Choose an episode from this purchase order's show.");

  try {
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(vendorInvoices).values({
        organizationId: context.organizationId,
        vendorCompanyId: order.vendorCompanyId,
        showId: episode.showId,
        episodeId: episode.id,
        invoiceNumber: parsed.data.invoiceNumber,
        description: parsed.data.description,
        amount: String(parsed.data.amount),
        currency: context.currency,
        status: "received",
        invoiceDate: parsed.data.invoiceDate.toISOString().slice(0, 10),
        externalDocumentUrl: parsed.data.externalDocumentUrl ?? null,
      }).returning({ id: vendorInvoices.id });
      const [budgetLine] = await tx.insert(budgetLines).values({
        organizationId: context.organizationId,
        showId: episode.showId,
        seasonId: episode.seasonId,
        episodeId: episode.id,
        vendorInvoiceId: invoice.id,
        purchaseOrderId: order.id,
        externalCost: true,
        category: "Vendor invoice",
        description: `${order.poNumber} · ${parsed.data.invoiceNumber} · ${parsed.data.description}`,
        budgetedAmount: "0",
        actualAmount: String(parsed.data.amount),
        currency: context.currency,
        costType: "internal",
      }).returning({ id: budgetLines.id });
      const [allocation] = await tx.insert(purchaseOrderAllocations).values({
        organizationId: context.organizationId,
        purchaseOrderId: order.id,
        allocationType: "vendor_invoice",
        vendorInvoiceId: invoice.id,
        amount: String(parsed.data.amount),
        allocationDate: parsed.data.invoiceDate.toISOString().slice(0, 10),
        reference: parsed.data.invoiceNumber,
        description: parsed.data.description,
        createdByUserId: context.userId,
      }).returning({ id: purchaseOrderAllocations.id });
      return { invoice, budgetLine, allocation };
    });
    await Promise.all([
      writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "vendor_invoice.recorded", entityType: "vendor_invoice", entityId: result.invoice.id, metadata: { purchaseOrderId: order.id, budgetLineId: result.budgetLine.id, allocationId: result.allocation.id } }),
      writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "purchase_order.invoice_recorded", entityType: "purchase_order", entityId: order.id, metadata: { invoiceId: result.invoice.id, allocationId: result.allocation.id, budgetLineId: result.budgetLine.id, amount: parsed.data.amount, invoiceNumber: parsed.data.invoiceNumber } }),
    ]);
    return { ...result, purchaseOrder: await getPurchaseOrderDetailForOrganization(context.organizationId, order.id) };
  } catch (error) {
    if (error instanceof PurchaseOrderError) throw error;
    throw new PurchaseOrderError(409, "A supplier invoice with that reference already exists for this vendor.");
  }
}
