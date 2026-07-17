import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { crmCompanies, episodes, people, postWorkOrderItems, postWorkOrders, purchaseOrderAllocations, purchaseOrders, qcIssues, seasons, shows } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getTenantRolePolicies } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { updatePostWorkOrderSchema } from "@/lib/validations/entities";
import { planWorkOrderPurchaseOrderCommitment, PurchaseOrderError } from "@/server/purchase-orders";
import { ClientPurchaseOrderError, selectApplicableClientPurchaseOrder } from "@/server/client-purchase-orders";

export async function PATCH(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  const parsed = updatePostWorkOrderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the work-order update." }, { status: 400 });
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = context.organization.organizationId;
  const { workOrderId } = await params;
  const db = getDb();
  const [workOrder, person] = await Promise.all([
    db.select().from(postWorkOrders).where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId))).limit(1),
    db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.organizationId, organizationId), eq(people.userId, context.userId))).limit(1),
  ]);
  if (!workOrder[0]) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  const mayManage = await can("manage_work_orders");
  const mayApprove = await can("approve_work_orders");
  const mayManageCommercial = await can("manage_budget");
  const mayUpdateAssigned = await can("update_assigned_work");
  const mayVerifyQc = await can("verify_qc");
  const isAssigned = Boolean(person[0] && (workOrder[0].assigneePersonId === person[0].id || workOrder[0].assigneeRole === person[0].role));
  if (!mayManage && !(mayUpdateAssigned && isAssigned) && !(mayApprove && parsed.data.status !== undefined)) return NextResponse.json({ error: "You can only update work assigned to you." }, { status: 403 });
  const managerFields = ["title", "description", "department", "assigneePersonId", "assigneeRole", "workType", "vendorCompanyId", "purchaseOrderId", "clientPurchaseOrderId", "priority", "isBlocking", "billingScope", "estimatedAmount", "clientQuoteAmount", "billingNotes", "items", "externalUrl", "dueAt"];
  if (!mayManage && managerFields.some((field) => field in parsed.data)) return NextResponse.json({ error: "Only post management can change work-order details or assignments." }, { status: 403 });
  const commercialFields = ["clientPurchaseOrderId", "estimatedAmount", "clientQuoteAmount", "billingNotes", "items"];
  if (!mayManageCommercial && commercialFields.some((field) => field in parsed.data)) return NextResponse.json({ error: "Only users with the Budget permission can set commercial values." }, { status: 403 });
  if (workOrder[0].billingStatus === "posted" && ["billingScope", "estimatedAmount", "clientQuoteAmount", "billingNotes", "items"].some((field) => field in parsed.data)) return NextResponse.json({ error: "A charge already posted to budget cannot be changed here." }, { status: 409 });
  const missing = mayManage ? await missingTenantReferences(organizationId, { personId: parsed.data.assigneePersonId, companyId: parsed.data.vendorCompanyId }) : [];
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this post house.` }, { status: 404 });
  const nextWorkType = parsed.data.workType ?? workOrder[0].workType;
  const nextBillingScope = parsed.data.billingScope ?? workOrder[0].billingScope;
  const nextVendorCompanyId = nextWorkType === "external_vendor" ? (parsed.data.vendorCompanyId === undefined ? workOrder[0].vendorCompanyId : parsed.data.vendorCompanyId) : null;
  const nextPurchaseOrderId = nextWorkType === "external_vendor" ? (parsed.data.purchaseOrderId === undefined ? workOrder[0].purchaseOrderId : parsed.data.purchaseOrderId) : null;
  const nextClientPurchaseOrderId = nextWorkType === "internal" && nextBillingScope === "billable_change" ? (parsed.data.clientPurchaseOrderId === undefined ? workOrder[0].clientPurchaseOrderId : parsed.data.clientPurchaseOrderId) : null;
  if (nextWorkType === "internal" && ((parsed.data.vendorCompanyId ?? null) || (parsed.data.purchaseOrderId ?? null) || parsed.data.estimatedAmount !== undefined && parsed.data.estimatedAmount !== null)) return NextResponse.json({ error: "Internal work cannot include a vendor, PO, or vendor estimate." }, { status: 400 });
  if (nextWorkType === "external_vendor" && !nextVendorCompanyId) return NextResponse.json({ error: "Choose a vendor for external work." }, { status: 400 });
  const [[vendor], [purchaseOrder], [episodeScope]] = await Promise.all([
    nextVendorCompanyId ? db.select({ type: crmCompanies.type }).from(crmCompanies).where(and(eq(crmCompanies.id, nextVendorCompanyId), eq(crmCompanies.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    nextPurchaseOrderId ? db.select({ vendorCompanyId: purchaseOrders.vendorCompanyId, showId: purchaseOrders.showId, episodeId: purchaseOrders.episodeId, status: purchaseOrders.status }).from(purchaseOrders).where(and(eq(purchaseOrders.id, nextPurchaseOrderId), eq(purchaseOrders.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    db.select({ showId: shows.id, clientCompanyId: shows.clientCompanyId }).from(episodes).innerJoin(seasons, eq(episodes.seasonId, seasons.id)).innerJoin(shows, eq(seasons.showId, shows.id)).where(and(eq(episodes.id, workOrder[0].episodeId), eq(episodes.organizationId, organizationId), eq(seasons.organizationId, organizationId), eq(shows.organizationId, organizationId))).limit(1),
  ]);
  if (nextWorkType === "external_vendor" && (!vendor || vendor.type !== "vendor")) return NextResponse.json({ error: "Select a vendor account for external work." }, { status: 400 });
  if (nextPurchaseOrderId && !purchaseOrder) return NextResponse.json({ error: "Purchase order not found for this post house." }, { status: 404 });
  if (purchaseOrder && (!episodeScope || purchaseOrder.status !== "approved" || purchaseOrder.vendorCompanyId !== nextVendorCompanyId || purchaseOrder.showId && purchaseOrder.showId !== episodeScope.showId || purchaseOrder.episodeId && purchaseOrder.episodeId !== workOrder[0].episodeId)) return NextResponse.json({ error: "Select an approved PO for this vendor and episode." }, { status: 409 });
  if (nextClientPurchaseOrderId) {
    try { await selectApplicableClientPurchaseOrder(organizationId, { clientPurchaseOrderId: nextClientPurchaseOrderId, clientCompanyId: episodeScope?.clientCompanyId ?? null, showId: episodeScope!.showId, episodeId: workOrder[0].episodeId }); }
    catch (error) { if (error instanceof ClientPurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  }
  const status = parsed.data.status;
  const nextStatus = status ?? workOrder[0].status;
  const isQcException = workOrder[0].kind === "qc_exception";
  const approvalDecision = !isQcException && workOrder[0].status === "awaiting_approval" && (status === "in_progress" || status === "rejected");
  if (parsed.data.approvalNote !== undefined && !approvalDecision) return NextResponse.json({ error: "An approval note can only be added when approving or returning a submitted work order." }, { status: 409 });
  if (parsed.data.overrunReason !== undefined && !(approvalDecision && status === "in_progress")) return NextResponse.json({ error: "A PO overrun reason can only be added while approving work." }, { status: 409 });
  if (!isQcException && status) {
    if (["open", "rejected"].includes(workOrder[0].status)) {
      if (!mayManage) return NextResponse.json({ error: "Only a work-order manager can submit a draft for approval." }, { status: 403 });
      if (!["awaiting_approval", "cancelled"].includes(status)) return NextResponse.json({ error: "Submit this draft for approval before work can begin." }, { status: 409 });
    } else if (workOrder[0].status === "awaiting_approval") {
      if (!mayApprove) return NextResponse.json({ error: "Your role needs the Approve work orders permission." }, { status: 403 });
      if (!["in_progress", "rejected", "cancelled"].includes(status)) return NextResponse.json({ error: "Submitted work can only be approved, returned for changes, or cancelled." }, { status: 409 });
      if (status === "in_progress" && workOrder[0].createdByUserId === context.userId) return NextResponse.json({ error: "The person who created a work order cannot approve it." }, { status: 403 });
    } else if (workOrder[0].status === "in_progress") {
      if (status !== "complete" && !(mayManage && status === "cancelled")) return NextResponse.json({ error: "Approved work can only be completed or cancelled." }, { status: 409 });
    } else if (["complete", "cancelled"].includes(workOrder[0].status)) {
      return NextResponse.json({ error: "A completed or cancelled work order cannot be changed." }, { status: 409 });
    }
  }
  if (workOrder[0].kind === "qc_exception" && status === "complete" && !mayVerifyQc) return NextResponse.json({ error: "Your role needs the QC verification permission to close a QC exception. Mark it ready for re-QC instead." }, { status: 403 });
  const isComplete = nextStatus === "complete";
  const billingScope = nextBillingScope;
  // Completing a client-billable work order makes it ready for a Budget user
  // to post. There is no intermediate Accounts approval state.
  const billingStatus = billingScope !== "billable_change" ? "not_billable" : workOrder[0].billingStatus;
  const qcHandOff = workOrder[0].kind === "qc_exception" && status === "ready_for_review";
  const verificationRole = qcHandOff ? (await getTenantRolePolicies(organizationId)).find((policy) => policy.permissions.includes("verify_qc"))?.role : null;
  if (qcHandOff && !verificationRole) return NextResponse.json({ error: "Configure a role with QC verification before sending this exception to re-QC." }, { status: 409 });
  const nextEstimatedAmount = nextWorkType === "external_vendor"
    ? (parsed.data.estimatedAmount === undefined ? workOrder[0].estimatedAmount : parsed.data.estimatedAmount)
    : null;
  const [existingPoCommitment] = await db.select({ id: purchaseOrderAllocations.id, purchaseOrderId: purchaseOrderAllocations.purchaseOrderId })
    .from(purchaseOrderAllocations)
    .where(and(eq(purchaseOrderAllocations.organizationId, organizationId), eq(purchaseOrderAllocations.workOrderId, workOrderId), eq(purchaseOrderAllocations.allocationType, "work_order")))
    .limit(1);
  const shouldReleasePoCommitment = Boolean(existingPoCommitment && (nextWorkType !== "external_vendor" || !nextPurchaseOrderId));
  const shouldSynchronisePoCommitment = Boolean(nextWorkType === "external_vendor" && nextPurchaseOrderId && (
    (approvalDecision && status === "in_progress")
    || (existingPoCommitment && (parsed.data.purchaseOrderId !== undefined || parsed.data.estimatedAmount !== undefined || parsed.data.workType !== undefined))
  ));
  let poCommitment: Awaited<ReturnType<typeof planWorkOrderPurchaseOrderCommitment>> | null = null;
  if (shouldSynchronisePoCommitment) {
    try {
      poCommitment = await planWorkOrderPurchaseOrderCommitment({ organizationId, workOrderId, purchaseOrderId: nextPurchaseOrderId!, estimatedAmount: nextEstimatedAmount, overrunReason: parsed.data.overrunReason });
    } catch (error) {
      if (error instanceof PurchaseOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  const { estimatedAmount: _estimatedAmount, clientQuoteAmount, approvalNote, overrunReason: _overrunReason, items, ...workOrderUpdate } = parsed.data;
  void _estimatedAmount;
  void _overrunReason;
  const completionChanged = status !== undefined;
  await db.transaction(async (tx) => {
    await tx.update(postWorkOrders).set({ ...workOrderUpdate, workType: nextWorkType, vendorCompanyId: nextVendorCompanyId, purchaseOrderId: nextPurchaseOrderId, clientPurchaseOrderId: nextClientPurchaseOrderId, estimatedAmount: nextEstimatedAmount === null ? null : String(nextEstimatedAmount), clientQuoteAmount: clientQuoteAmount === undefined || clientQuoteAmount === null ? clientQuoteAmount : String(clientQuoteAmount), billingStatus, assigneePersonId: qcHandOff ? null : parsed.data.assigneePersonId, assigneeRole: qcHandOff ? verificationRole : parsed.data.assigneeRole, approvedByPersonId: approvalDecision && status === "in_progress" ? person[0]?.id ?? null : workOrder[0].approvedByPersonId, approvedAt: approvalDecision && status === "in_progress" ? new Date() : workOrder[0].approvedAt, approvalNote: approvalDecision ? approvalNote ?? null : workOrder[0].approvalNote, completedByPersonId: completionChanged ? (isComplete ? person[0]?.id ?? null : null) : workOrder[0].completedByPersonId, completedAt: completionChanged ? (isComplete ? new Date() : null) : workOrder[0].completedAt, updatedAt: new Date() }).where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId)));
    if (poCommitment) {
      if (poCommitment.allocationId) await tx.update(purchaseOrderAllocations).set({ purchaseOrderId: poCommitment.purchaseOrderId, amount: poCommitment.amount, allocationDate: poCommitment.allocationDate, reference: poCommitment.reference, description: poCommitment.description, updatedAt: new Date() }).where(and(eq(purchaseOrderAllocations.id, poCommitment.allocationId), eq(purchaseOrderAllocations.organizationId, organizationId)));
      else await tx.insert(purchaseOrderAllocations).values({ organizationId, purchaseOrderId: poCommitment.purchaseOrderId, allocationType: "work_order", workOrderId, amount: poCommitment.amount, allocationDate: poCommitment.allocationDate, reference: poCommitment.reference, description: poCommitment.description, createdByUserId: context.userId });
    }
    if (shouldReleasePoCommitment && existingPoCommitment) await tx.delete(purchaseOrderAllocations).where(and(eq(purchaseOrderAllocations.id, existingPoCommitment.id), eq(purchaseOrderAllocations.organizationId, organizationId)));
    if (items !== undefined) {
      await tx.delete(postWorkOrderItems).where(and(eq(postWorkOrderItems.organizationId, organizationId), eq(postWorkOrderItems.workOrderId, workOrderId)));
      if (items.length) await tx.insert(postWorkOrderItems).values(items.map((item, index) => ({ organizationId, workOrderId, type: item.type, description: item.description, quantity: String(item.quantity), unit: item.unit, unitRate: String(item.unitRate), discountPercent: String(item.discountPercent), notes: item.notes ?? null, position: index + 1 })));
    }
  });
  if (workOrder[0].kind === "qc_exception" && isComplete && workOrder[0].qcIssueId) await db.update(qcIssues).set({ status: "resolved", resolution: "Verified through linked QC correction work order.", resolvedAt: new Date(), updatedAt: new Date() }).where(and(eq(qcIssues.id, workOrder[0].qcIssueId), eq(qcIssues.organizationId, organizationId)));
  if (poCommitment) await writeAuditEvent({ organizationId, actorUserId: context.userId, action: poCommitment.overrunAmount > 0 ? "purchase_order.work_order_overrun_authorised" : "purchase_order.work_order_committed", entityType: "purchase_order", entityId: poCommitment.purchaseOrderId, metadata: { workOrderId, allocationId: poCommitment.allocationId, amount: poCommitment.amount, overrunAmount: poCommitment.overrunAmount, overrunReason: poCommitment.overrunReason } });
  if (shouldReleasePoCommitment && existingPoCommitment) await writeAuditEvent({ organizationId, actorUserId: context.userId, action: "purchase_order.work_order_commitment_released", entityType: "purchase_order", entityId: existingPoCommitment.purchaseOrderId, metadata: { workOrderId, allocationId: existingPoCommitment.id } });
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: isComplete ? "work_order.completed" : approvalDecision && status === "in_progress" ? "work_order.approved" : approvalDecision ? "work_order.returned" : status === "awaiting_approval" ? "work_order.submitted" : "work_order.updated", entityType: "post_work_order", entityId: workOrderId, metadata: { episodeId: workOrder[0].episodeId, status: status ?? workOrder[0].status, billingStatus } });
  return NextResponse.json({ ok: true });
}
