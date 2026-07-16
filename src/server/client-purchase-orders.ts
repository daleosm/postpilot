import "server-only";

import { and, eq } from "drizzle-orm";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { billables, clientInvoiceItems, clientInvoices, clientPurchaseOrderAllocations, clientPurchaseOrders, crmCompanies, episodes, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import { createClientPurchaseOrderAllocationSchema, createClientPurchaseOrderSchema, updateClientPurchaseOrderSchema } from "@/lib/validations/entities";
import { getClientPurchaseOrderDetailForOrganization, listApplicableClientPurchaseOrdersForBilling } from "@/server/data/client-purchase-orders";

export class ClientPurchaseOrderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export type ClientPurchaseOrderBillingSelection = {
  id: string;
  poNumber: string;
  currency: string;
  authorisedAmount: number;
  committedToBillAmount: number;
  invoicedAmount: number;
  remainingAmount: number;
};

type ActiveClientPoContext = { organizationId: string; currency: string; userId: string };
type ClientPurchaseOrderScope = { clientCompanyId: string; showId: string | null; episodeId: string | null };

const calculatedFieldNames = new Set(["authorisedAmount", "committedToBillAmount", "invoicedAmount", "remainingAmount", "varianceAmount"]);
const toDate = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;

function rejectClientIdentityOrCalculatedPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const keys = Object.keys(payload);
  if (keys.some((key) => calculatedFieldNames.has(key))) throw new ClientPurchaseOrderError(400, "Client PO balances are calculated from allocations and cannot be edited.");
  if (keys.some((key) => ["organizationId", "clientPurchaseOrderId", "createdByUserId"].includes(key))) throw new ClientPurchaseOrderError(400, "Tenant and client PO identity are resolved by the server.");
}

async function requireActiveContext(): Promise<ActiveClientPoContext> {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) throw new ClientPurchaseOrderError(401, "No active post house.");
  return { organizationId: context.organization.organizationId, currency: context.organization.currency, userId: context.userId };
}

async function requireBudgetManager() {
  const context = await requireActiveContext();
  if (!(await can("manage_budget"))) throw new ClientPurchaseOrderError(403, "Your role needs the Budget permission.");
  return context;
}

async function requireBudgetApprover() {
  const context = await requireActiveContext();
  if (!(await can("approve_budget_overruns"))) throw new ClientPurchaseOrderError(403, "Your role needs the Budget approval permission.");
  return context;
}

async function resolveClientPurchaseOrderScope(organizationId: string, scope: ClientPurchaseOrderScope) {
  const db = getDb();
  const [[client], [show], [episode]] = await Promise.all([
    db.select({ id: crmCompanies.id, type: crmCompanies.type }).from(crmCompanies)
      .where(and(eq(crmCompanies.id, scope.clientCompanyId), eq(crmCompanies.organizationId, organizationId))).limit(1),
    scope.showId ? db.select({ id: shows.id }).from(shows).where(and(eq(shows.id, scope.showId), eq(shows.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    scope.episodeId ? db.select({ id: episodes.id, showId: shows.id }).from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id))
      .where(and(eq(episodes.id, scope.episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1) : Promise.resolve([]),
  ]);
  if (!client) throw new ClientPurchaseOrderError(404, "Client account not found in this post house.");
  if (client.type === "vendor") throw new ClientPurchaseOrderError(400, "Select a client, network, studio, or production company account.");
  if (scope.showId && !show) throw new ClientPurchaseOrderError(404, "Show not found in this post house.");
  if (scope.episodeId && !episode) throw new ClientPurchaseOrderError(404, "Episode not found in this post house.");
  if (scope.showId && episode && scope.showId !== episode.showId) throw new ClientPurchaseOrderError(400, "The selected episode does not belong to the selected show.");
  return { showId: scope.showId ?? episode?.showId ?? null, episodeId: scope.episodeId ?? null };
}

function validStatusTransition(current: "draft" | "active" | "closed" | "cancelled", next: "draft" | "active" | "closed" | "cancelled") {
  if (current === next) return true;
  return (current === "draft" && ["active", "cancelled"].includes(next))
    || (current === "active" && ["closed", "cancelled"].includes(next));
}

/** Validate a selected client PO against the server-owned billable scope. */
export async function selectApplicableClientPurchaseOrder(organizationId: string, selection: { clientPurchaseOrderId: string; clientCompanyId: string | null; showId: string; episodeId: string }): Promise<ClientPurchaseOrderBillingSelection> {
  const applicable = await listApplicableClientPurchaseOrdersForBilling(organizationId, selection);
  const order = applicable.find((candidate) => candidate.id === selection.clientPurchaseOrderId);
  if (!order) throw new ClientPurchaseOrderError(404, "The selected active client PO is not applicable to this client, show, or episode.");
  return {
    id: order.id, poNumber: order.poNumber, currency: order.currency, authorisedAmount: order.authorisedAmount,
    committedToBillAmount: order.committedToBillAmount, invoicedAmount: order.invoicedAmount, remainingAmount: order.remainingAmount,
  };
}

export async function createActiveClientPurchaseOrder(payload: unknown) {
  rejectClientIdentityOrCalculatedPayload(payload);
  const parsed = createClientPurchaseOrderSchema.safeParse(payload);
  if (!parsed.success) throw new ClientPurchaseOrderError(400, parsed.error.issues[0]?.message ?? "Check the client purchase order.");
  if (parsed.data.status !== "draft") throw new ClientPurchaseOrderError(403, "Only a budget approver can activate, close, or cancel a client PO.");
  const context = await requireBudgetManager();
  const scope = await resolveClientPurchaseOrderScope(context.organizationId, { ...parsed.data, showId: parsed.data.showId ?? null, episodeId: parsed.data.episodeId ?? null });
  try {
    const [order] = await getDb().insert(clientPurchaseOrders).values({
      organizationId: context.organizationId, clientCompanyId: parsed.data.clientCompanyId, showId: scope.showId, episodeId: scope.episodeId,
      poNumber: parsed.data.poNumber, currency: context.currency, approvedAmount: String(parsed.data.approvedAmount),
      issueDate: toDate(parsed.data.issueDate), expiryDate: toDate(parsed.data.expiryDate), status: "draft",
      notes: parsed.data.notes ?? null, externalDocumentUrl: parsed.data.externalDocumentUrl ?? null, createdByUserId: context.userId,
    }).returning({ id: clientPurchaseOrders.id });
    await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: "client_purchase_order.created", entityType: "client_purchase_order", entityId: order.id, metadata: { poNumber: parsed.data.poNumber } });
    return getClientPurchaseOrderDetailForOrganization(context.organizationId, order.id);
  } catch (error) {
    if (error instanceof ClientPurchaseOrderError) throw error;
    throw new ClientPurchaseOrderError(409, "A client PO with that number already exists in this post house.");
  }
}

export async function updateActiveClientPurchaseOrder(purchaseOrderId: string, payload: unknown) {
  rejectClientIdentityOrCalculatedPayload(payload);
  const parsed = updateClientPurchaseOrderSchema.safeParse(payload);
  if (!parsed.success || !Object.keys(parsed.data).length) throw new ClientPurchaseOrderError(400, parsed.success ? "Provide at least one client PO change." : parsed.error.issues[0]?.message ?? "Check the client purchase order.");
  const context = await requireActiveContext();
  const [order] = await getDb().select().from(clientPurchaseOrders)
    .where(and(eq(clientPurchaseOrders.id, purchaseOrderId), eq(clientPurchaseOrders.organizationId, context.organizationId))).limit(1);
  if (!order) throw new ClientPurchaseOrderError(404, "Client purchase order not found.");

  const requestedStatus = parsed.data.status;
  const hasStatusChange = requestedStatus !== undefined && requestedStatus !== order.status;
  const editableFields = { ...parsed.data };
  delete editableFields.status;
  if (hasStatusChange) {
    await requireBudgetApprover();
    if (!validStatusTransition(order.status, requestedStatus!)) throw new ClientPurchaseOrderError(409, "That client PO status transition is not allowed.");
  }
  if (Object.keys(editableFields).length) {
    if (order.status !== "draft") throw new ClientPurchaseOrderError(409, "Only draft client POs can be edited.");
    await requireBudgetManager();
  }
  if (!hasStatusChange && !Object.keys(editableFields).length) throw new ClientPurchaseOrderError(400, "Provide a client PO change.");

  const scope = Object.keys(editableFields).length ? await resolveClientPurchaseOrderScope(context.organizationId, {
    clientCompanyId: editableFields.clientCompanyId ?? order.clientCompanyId,
    showId: editableFields.showId === undefined ? order.showId : editableFields.showId,
    episodeId: editableFields.episodeId === undefined ? order.episodeId : editableFields.episodeId,
  }) : { showId: order.showId, episodeId: order.episodeId };
  await getDb().update(clientPurchaseOrders).set({
    ...(editableFields.clientCompanyId === undefined ? {} : { clientCompanyId: editableFields.clientCompanyId }),
    ...(editableFields.poNumber === undefined ? {} : { poNumber: editableFields.poNumber }),
    ...(editableFields.approvedAmount === undefined ? {} : { approvedAmount: String(editableFields.approvedAmount) }),
    ...(editableFields.issueDate === undefined ? {} : { issueDate: toDate(editableFields.issueDate) }),
    ...(editableFields.expiryDate === undefined ? {} : { expiryDate: toDate(editableFields.expiryDate) }),
    ...(editableFields.notes === undefined ? {} : { notes: editableFields.notes }),
    ...(editableFields.externalDocumentUrl === undefined ? {} : { externalDocumentUrl: editableFields.externalDocumentUrl }),
    ...(Object.keys(editableFields).length ? { showId: scope.showId, episodeId: scope.episodeId } : {}),
    ...(hasStatusChange ? { status: requestedStatus } : {}),
    updatedAt: new Date(),
  }).where(and(eq(clientPurchaseOrders.id, purchaseOrderId), eq(clientPurchaseOrders.organizationId, context.organizationId)));
  const action = hasStatusChange ? `client_purchase_order.${requestedStatus === "active" ? "activated" : requestedStatus}` : "client_purchase_order.updated";
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action, entityType: "client_purchase_order", entityId: purchaseOrderId, metadata: { poNumber: editableFields.poNumber ?? order.poNumber } });
  return getClientPurchaseOrderDetailForOrganization(context.organizationId, purchaseOrderId);
}

async function validateAllocationSource(organizationId: string, order: typeof clientPurchaseOrders.$inferSelect, input: { allocationType: "billable" | "client_invoice" | "change_order"; billableId?: string | null; clientInvoiceId?: string | null; clientInvoiceItemId?: string | null; changeOrderReference?: string | null }) {
  if (input.allocationType === "change_order") return;
  const db = getDb();
  if (input.allocationType === "billable") {
    const [billable] = await db.select({ showId: billables.showId, episodeId: billables.episodeId, status: billables.status, clientInvoiceId: billables.clientInvoiceId })
      .from(billables).where(and(eq(billables.id, input.billableId!), eq(billables.organizationId, organizationId))).limit(1);
    if (!billable) throw new ClientPurchaseOrderError(404, "Billable not found in this post house.");
    if (!["approved", "invoiced", "paid"].includes(billable.status)) throw new ClientPurchaseOrderError(409, "Only approved or invoiced billables can consume a client PO.");
    if (order.showId && billable.showId !== order.showId) throw new ClientPurchaseOrderError(400, "The billable belongs to a different show.");
    if (order.episodeId && billable.episodeId !== order.episodeId) throw new ClientPurchaseOrderError(400, "The billable belongs to a different episode.");
    return;
  }
  const invoiceId = input.clientInvoiceItemId
    ? (await db.select({ clientInvoiceId: clientInvoiceItems.clientInvoiceId }).from(clientInvoiceItems).where(and(eq(clientInvoiceItems.id, input.clientInvoiceItemId), eq(clientInvoiceItems.organizationId, organizationId))).limit(1))[0]?.clientInvoiceId
    : input.clientInvoiceId;
  const [invoice] = await db.select({ clientCompanyId: clientInvoices.clientCompanyId, showId: clientInvoices.showId, episodeId: clientInvoices.episodeId, status: clientInvoices.status })
    .from(clientInvoices).where(and(eq(clientInvoices.id, invoiceId!), eq(clientInvoices.organizationId, organizationId))).limit(1);
  if (!invoice) throw new ClientPurchaseOrderError(404, "Client invoice not found in this post house.");
  if (!["issued", "paid"].includes(invoice.status)) throw new ClientPurchaseOrderError(409, "Only issued or paid client invoices can consume a client PO.");
  if (invoice.clientCompanyId !== order.clientCompanyId) throw new ClientPurchaseOrderError(400, "The invoice belongs to a different client account.");
  if (order.showId && invoice.showId !== order.showId) throw new ClientPurchaseOrderError(400, "The invoice belongs to a different show.");
  if (order.episodeId && invoice.episodeId !== order.episodeId) throw new ClientPurchaseOrderError(400, "The invoice belongs to a different episode.");
}

export async function createActiveClientPurchaseOrderAllocation(purchaseOrderId: string, payload: unknown) {
  rejectClientIdentityOrCalculatedPayload(payload);
  const parsed = createClientPurchaseOrderAllocationSchema.safeParse(payload);
  if (!parsed.success) throw new ClientPurchaseOrderError(400, parsed.error.issues[0]?.message ?? "Check the client PO allocation.");
  const context = await requireBudgetManager();
  const [order] = await getDb().select().from(clientPurchaseOrders)
    .where(and(eq(clientPurchaseOrders.id, purchaseOrderId), eq(clientPurchaseOrders.organizationId, context.organizationId))).limit(1);
  if (!order) throw new ClientPurchaseOrderError(404, "Client purchase order not found.");
  if (order.status !== "active") throw new ClientPurchaseOrderError(409, "Only active client POs can receive allocations.");
  await validateAllocationSource(context.organizationId, order, parsed.data);

  const existingPredicate = parsed.data.allocationType === "billable" ? eq(clientPurchaseOrderAllocations.billableId, parsed.data.billableId!)
    : parsed.data.allocationType === "client_invoice" ? (parsed.data.clientInvoiceItemId ? eq(clientPurchaseOrderAllocations.clientInvoiceItemId, parsed.data.clientInvoiceItemId) : eq(clientPurchaseOrderAllocations.clientInvoiceId, parsed.data.clientInvoiceId!))
      : eq(clientPurchaseOrderAllocations.changeOrderReference, parsed.data.changeOrderReference!);
  const [existing] = await getDb().select({ id: clientPurchaseOrderAllocations.id }).from(clientPurchaseOrderAllocations)
    .where(and(eq(clientPurchaseOrderAllocations.organizationId, context.organizationId), eq(clientPurchaseOrderAllocations.clientPurchaseOrderId, purchaseOrderId), existingPredicate)).limit(1);
  if (existing) throw new ClientPurchaseOrderError(409, "This client billing record already has a client PO allocation.");

  const detail = await getClientPurchaseOrderDetailForOrganization(context.organizationId, purchaseOrderId);
  if (!detail) throw new ClientPurchaseOrderError(404, "Client purchase order not found.");
  const nextCommitted = detail.committedToBillAmount + (["billable", "change_order"].includes(parsed.data.allocationType) ? parsed.data.amount : 0);
  const nextInvoiced = detail.invoicedAmount + (parsed.data.allocationType === "client_invoice" ? parsed.data.amount : 0);
  const overrunAmount = Math.max(nextCommitted, nextInvoiced) - detail.authorisedAmount;
  if (overrunAmount > 0) {
    if (!parsed.data.overrunReason?.trim()) throw new ClientPurchaseOrderError(400, "Explain the client PO overrun before authorising it.");
    await requireBudgetApprover();
  }
  const [allocation] = await getDb().insert(clientPurchaseOrderAllocations).values({
    organizationId: context.organizationId, clientPurchaseOrderId: purchaseOrderId, allocationType: parsed.data.allocationType,
    billableId: parsed.data.billableId ?? null, clientInvoiceId: parsed.data.clientInvoiceId ?? null, clientInvoiceItemId: parsed.data.clientInvoiceItemId ?? null, changeOrderReference: parsed.data.changeOrderReference ?? null,
    amount: String(parsed.data.amount), overrunAuthorised: overrunAmount > 0, allocationDate: toDate(parsed.data.allocationDate)!, reference: parsed.data.reference ?? null,
    description: parsed.data.description ?? null, createdByUserId: context.userId,
  }).returning({ id: clientPurchaseOrderAllocations.id });
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, action: overrunAmount > 0 ? "client_purchase_order.overrun_authorised" : "client_purchase_order.allocated", entityType: "client_purchase_order", entityId: purchaseOrderId, metadata: { allocationId: allocation.id, allocationType: parsed.data.allocationType, amount: parsed.data.amount, overrunAmount: Math.max(0, overrunAmount), overrunReason: parsed.data.overrunReason ?? null } });
  return getClientPurchaseOrderDetailForOrganization(context.organizationId, purchaseOrderId);
}
