import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { writeAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { crmCompanies, people, postWorkOrders, qcIssues } from "@/lib/db/schema";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { can, getTenantRolePolicies } from "@/lib/permissions";
import { missingTenantReferences } from "@/lib/tenant-resources";
import { updatePostWorkOrderSchema } from "@/lib/validations/entities";

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
  const managerFields = ["title", "description", "department", "assigneePersonId", "assigneeRole", "vendorCompanyId", "priority", "isBlocking", "billingScope", "estimatedAmount", "clientQuoteAmount", "billingNotes", "externalUrl", "dueAt"];
  if (!mayManage && managerFields.some((field) => field in parsed.data)) return NextResponse.json({ error: "Only post management can change work-order details or assignments." }, { status: 403 });
  const commercialFields = ["estimatedAmount", "clientQuoteAmount", "billingNotes"];
  if (!mayManageCommercial && commercialFields.some((field) => field in parsed.data)) return NextResponse.json({ error: "Only users with the Budget permission can set commercial values." }, { status: 403 });
  if (workOrder[0].billingStatus === "posted" && ["billingScope", "estimatedAmount", "clientQuoteAmount", "billingNotes"].some((field) => field in parsed.data)) return NextResponse.json({ error: "A charge already posted to budget cannot be changed here." }, { status: 409 });
  const missing = mayManage ? await missingTenantReferences(organizationId, { personId: parsed.data.assigneePersonId, companyId: parsed.data.vendorCompanyId }) : [];
  if (missing.length) return NextResponse.json({ error: `Invalid ${missing.join(", ")} for this post house.` }, { status: 404 });
  if (mayManage && parsed.data.vendorCompanyId) {
    const [vendor] = await db.select({ type: crmCompanies.type }).from(crmCompanies).where(and(eq(crmCompanies.id, parsed.data.vendorCompanyId), eq(crmCompanies.organizationId, organizationId))).limit(1);
    if (!vendor || vendor.type !== "vendor") return NextResponse.json({ error: "Select a vendor account for external work." }, { status: 400 });
  }
  const status = parsed.data.status;
  const nextStatus = status ?? workOrder[0].status;
  const isQcException = workOrder[0].kind === "qc_exception";
  const approvalDecision = !isQcException && workOrder[0].status === "awaiting_approval" && (status === "in_progress" || status === "rejected");
  if (parsed.data.approvalNote !== undefined && !approvalDecision) return NextResponse.json({ error: "An approval note can only be added when approving or returning a submitted work order." }, { status: 409 });
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
  const billingScope = parsed.data.billingScope ?? workOrder[0].billingScope;
  const billingStatus = billingScope !== "billable_change"
    ? "not_billable"
    : isComplete && workOrder[0].billingStatus === "draft"
      ? "awaiting_finance"
      : workOrder[0].billingStatus;
  const qcHandOff = workOrder[0].kind === "qc_exception" && status === "ready_for_review";
  const verificationRole = qcHandOff ? (await getTenantRolePolicies(organizationId)).find((policy) => policy.permissions.includes("verify_qc"))?.role : null;
  if (qcHandOff && !verificationRole) return NextResponse.json({ error: "Configure a role with QC verification before sending this exception to re-QC." }, { status: 409 });
  const { estimatedAmount, clientQuoteAmount, approvalNote, ...workOrderUpdate } = parsed.data;
  const completionChanged = status !== undefined;
  await db.update(postWorkOrders).set({ ...workOrderUpdate, estimatedAmount: estimatedAmount === undefined || estimatedAmount === null ? estimatedAmount : String(estimatedAmount), clientQuoteAmount: clientQuoteAmount === undefined || clientQuoteAmount === null ? clientQuoteAmount : String(clientQuoteAmount), billingStatus, assigneePersonId: qcHandOff ? null : parsed.data.assigneePersonId, assigneeRole: qcHandOff ? verificationRole : parsed.data.assigneeRole, approvedByPersonId: approvalDecision && status === "in_progress" ? person[0]?.id ?? null : workOrder[0].approvedByPersonId, approvedAt: approvalDecision && status === "in_progress" ? new Date() : workOrder[0].approvedAt, approvalNote: approvalDecision ? approvalNote ?? null : workOrder[0].approvalNote, completedByPersonId: completionChanged ? (isComplete ? person[0]?.id ?? null : null) : workOrder[0].completedByPersonId, completedAt: completionChanged ? (isComplete ? new Date() : null) : workOrder[0].completedAt, updatedAt: new Date() }).where(and(eq(postWorkOrders.id, workOrderId), eq(postWorkOrders.organizationId, organizationId)));
  if (workOrder[0].kind === "qc_exception" && isComplete && workOrder[0].qcIssueId) await db.update(qcIssues).set({ status: "resolved", resolution: "Verified through linked QC correction work order.", resolvedAt: new Date(), updatedAt: new Date() }).where(and(eq(qcIssues.id, workOrder[0].qcIssueId), eq(qcIssues.organizationId, organizationId)));
  await writeAuditEvent({ organizationId, actorUserId: context.userId, action: isComplete ? "work_order.completed" : approvalDecision && status === "in_progress" ? "work_order.approved" : approvalDecision ? "work_order.returned" : status === "awaiting_approval" ? "work_order.submitted" : "work_order.updated", entityType: "post_work_order", entityId: workOrderId, metadata: { episodeId: workOrder[0].episodeId, status: status ?? workOrder[0].status, billingStatus } });
  return NextResponse.json({ ok: true });
}
